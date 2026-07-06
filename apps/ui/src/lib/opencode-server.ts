import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { renderSourceSessionDownload } from './source-session-export-server';

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const sessionSchema = z.object({
    sessionId: z.string().min(1),
});

const exportSessionSchema = z.object({
    headroomArchiveDir: z.string().optional(),
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    rehydrateHeadroom: z.boolean().optional(),
    sessionId: z.string().min(1),
    zipArchive: z.boolean().default(false),
});

export const listOpenCodeWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listOpenCodeWorkspaceGroups } = await import('@spiracha/lib/opencode-db');
    return listOpenCodeWorkspaceGroups();
});

export const listOpenCodeSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listOpenCodeSessionsForGroup } = await import('@spiracha/lib/opencode-db');
        return listOpenCodeSessionsForGroup(data.workspaceKey);
    });

const loadOpenCodeSessionTranscript = async (sessionId: string) => {
    const { readOpenCodeSessionTranscript, resolveOpenCodeDbPath } = await import('@spiracha/lib/opencode-db');
    const transcript = await readOpenCodeSessionTranscript(resolveOpenCodeDbPath(), sessionId);
    if (!transcript) {
        throw new Error(`OpenCode session not found: ${sessionId}`);
    }

    return transcript;
};

export const getOpenCodeSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadOpenCodeSessionTranscript(data.sessionId);
    });

export const exportOpenCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderOpenCodeTranscript } = await import('@spiracha/lib/opencode-transcript');
        const transcript = await loadOpenCodeSessionTranscript(data.sessionId);
        const content = renderOpenCodeTranscript(transcript, {
            archiveDir: data.headroomArchiveDir,
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            rehydrateHeadroom: data.rehydrateHeadroom,
        });

        if (!content) {
            throw new Error(`OpenCode session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            fallbackBaseName: 'opencode-session',
            fileBaseName: transcript.session.title || transcript.session.slug || transcript.session.sessionId,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const deleteOpenCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteOpenCodeSession, resolveOpenCodeDbPath } = await import('@spiracha/lib/opencode-db');
        return deleteOpenCodeSession(resolveOpenCodeDbPath(), data.sessionId);
    });
