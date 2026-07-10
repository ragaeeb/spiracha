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
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readKiroSessionTranscript, resolveKiroWorkspaceSessionsDir } = await import('@spiracha/lib/kiro-db');
    const sessionsDir = resolveKiroWorkspaceSessionsDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readKiroSessionTranscript(sessionsDir, sessionId);
            if (!transcript) {
                throw new Error(`Kiro session not found: ${sessionId}`);
            }

            return transcript;
        },
        {
            id: sessionId,
            path: sessionsDir,
            source: 'kiro-ui',
        },
    );
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

export const exportKiroSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderKiroTranscript } = await import('@spiracha/lib/kiro-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadKiroSessionTranscript(sessionId);
                const content = renderKiroTranscript(transcript, {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                });

                if (!content) {
                    throw new Error(`Kiro session has no exportable content: ${sessionId}`);
                }

                return {
                    content,
                    fallbackBaseName: 'kiro-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            exportBaseName: `kiro-sessions-${data.sessionIds.length}`,
            fallbackBaseName: 'kiro-sessions',
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const deleteKiroSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteKiroSession, resolveKiroWorkspaceSessionsDir } = await import('@spiracha/lib/kiro-db');
        return deleteKiroSession(resolveKiroWorkspaceSessionsDir(), data.sessionId);
    });

export const deleteKiroSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteKiroSession, resolveKiroWorkspaceSessionsDir } = await import('@spiracha/lib/kiro-db');
        const sessionsDir = resolveKiroWorkspaceSessionsDir();
        return Promise.all(data.sessionIds.map((sessionId) => deleteKiroSession(sessionsDir, sessionId)));
    });
