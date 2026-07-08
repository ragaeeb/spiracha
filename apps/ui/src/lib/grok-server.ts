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

export const listGrokWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listGrokWorkspaceGroups } = await import('@spiracha/lib/grok-db');
    return listGrokWorkspaceGroups();
});

export const listGrokSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listGrokSessionsForGroup } = await import('@spiracha/lib/grok-db');
        return listGrokSessionsForGroup(data.workspaceKey);
    });

const loadGrokSessionTranscript = async (sessionId: string) => {
    const { readGrokSessionTranscript, resolveGrokSessionsDir } = await import('@spiracha/lib/grok-db');
    const transcript = await readGrokSessionTranscript(resolveGrokSessionsDir(), sessionId, {
        includeRawPayloads: false,
    });
    if (!transcript) {
        throw new Error(`Grok session not found: ${sessionId}`);
    }

    return transcript;
};

export const getGrokSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadGrokSessionTranscript(data.sessionId);
    });

export const exportGrokSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderGrokTranscript } = await import('@spiracha/lib/grok-transcript');
        const transcript = await loadGrokSessionTranscript(data.sessionId);
        const content = renderGrokTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });

        if (!content) {
            throw new Error(`Grok session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            fallbackBaseName: 'grok-session',
            fileBaseName: transcript.session.title || transcript.session.sessionId,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const exportGrokSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderGrokTranscript } = await import('@spiracha/lib/grok-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadGrokSessionTranscript(sessionId);
                const content = renderGrokTranscript(transcript, {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                });

                if (!content) {
                    throw new Error(`Grok session has no exportable content: ${sessionId}`);
                }

                return {
                    content,
                    fallbackBaseName: 'grok-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            exportBaseName: `grok-sessions-${data.sessionIds.length}`,
            fallbackBaseName: 'grok-sessions',
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const deleteGrokSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteGrokSession, resolveGrokSessionsDir } = await import('@spiracha/lib/grok-db');
        const result = await deleteGrokSession(resolveGrokSessionsDir(), data.sessionId);
        if (result.deletedSessionIds.length === 0) {
            throw new Error(`Grok session not found: ${data.sessionId}`);
        }

        return result;
    });

export const deleteGrokSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteGrokSession, resolveGrokSessionsDir } = await import('@spiracha/lib/grok-db');
        const sessionsDir = resolveGrokSessionsDir();
        const results = await Promise.all(
            data.sessionIds.map((sessionId) => deleteGrokSession(sessionsDir, sessionId)),
        );
        const deletedSessionIds = results.flatMap((result) => result.deletedSessionIds);
        if (deletedSessionIds.length === 0) {
            throw new Error('No Grok sessions were deleted');
        }

        return {
            deletedFiles: results.flatMap((result) => result.deletedFiles),
            deletedSessionIds,
        };
    });
