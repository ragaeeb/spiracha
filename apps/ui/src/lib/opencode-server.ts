import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

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

const exportSessionsSchema = z.object({
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    sessionIds: z.array(z.string().min(1)).min(1),
    zipArchive: z.boolean().default(true),
});

const deleteSessionsSchema = z.object({
    sessionIds: z.array(z.string().min(1)).min(1),
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
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readOpenCodeSessionTranscript, resolveOpenCodeDbPath } = await import('@spiracha/lib/opencode-db');
    const dbPath = resolveOpenCodeDbPath();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readOpenCodeSessionTranscript(dbPath, sessionId);
            if (!transcript) {
                throw new Error(`OpenCode session not found: ${sessionId}`);
            }

            return transcript;
        },
        {
            id: sessionId,
            path: dbPath,
            source: 'opencode-ui',
        },
    );
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
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
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

export const exportOpenCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderOpenCodeTranscript } = await import('@spiracha/lib/opencode-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadOpenCodeSessionTranscript(sessionId);
                const content = renderOpenCodeTranscript(transcript, {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                });

                if (!content) {
                    throw new Error(`OpenCode session has no exportable content: ${sessionId}`);
                }

                return {
                    content,
                    fallbackBaseName: 'opencode-session',
                    fileBaseName: transcript.session.title || transcript.session.slug || transcript.session.sessionId,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            exportBaseName: `opencode-sessions-${data.sessionIds.length}`,
            fallbackBaseName: 'opencode-sessions',
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

export const deleteOpenCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteOpenCodeSession, resolveOpenCodeDbPath } = await import('@spiracha/lib/opencode-db');
        const dbPath = resolveOpenCodeDbPath();
        return Promise.all(data.sessionIds.map((sessionId) => deleteOpenCodeSession(dbPath, sessionId)));
    });
