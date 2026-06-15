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
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    sessionId: z.string().min(1),
    zipArchive: z.boolean().default(false),
});

export const listKiroWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listKiroWorkspaceGroups } = await import('@spiracha/lib/kiro-db');
    return listKiroWorkspaceGroups();
});

export const listKiroSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listKiroSessionsForGroup } = await import('@spiracha/lib/kiro-db');
        return listKiroSessionsForGroup(data.workspaceKey);
    });

const loadKiroSessionTranscript = async (sessionId: string) => {
    const { readKiroSessionTranscript, resolveKiroWorkspaceSessionsDir } = await import('@spiracha/lib/kiro-db');
    const transcript = await readKiroSessionTranscript(resolveKiroWorkspaceSessionsDir(), sessionId);
    if (!transcript) {
        throw new Error(`Kiro session not found: ${sessionId}`);
    }

    return transcript;
};

export const getKiroSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadKiroSessionTranscript(data.sessionId);
    });

export const exportKiroSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderKiroTranscript } = await import('@spiracha/lib/kiro-transcript');
        const transcript = await loadKiroSessionTranscript(data.sessionId);
        const content = renderKiroTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });

        if (!content) {
            throw new Error(`Kiro session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            fallbackBaseName: 'kiro-session',
            fileBaseName: transcript.session.title || transcript.session.sessionId,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });
