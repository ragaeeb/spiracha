import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireDeletedItems, runDeleteBatch } from './delete-batch';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

const workspaceSchema = z.object({
    merged: z.boolean().default(false),
    workspaceKey: z.string().min(1),
});

const sessionSchema = z.object({
    merged: z.boolean().default(false),
    sessionId: z.string().min(1),
});

const exportSessionSchema = z.object({
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    merged: z.boolean().default(false),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    sessionId: z.string().min(1),
    zipArchive: z.boolean().default(false),
});

const exportSessionsSchema = z.object({
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    merged: z.boolean().default(false),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    sessionIds: z.array(z.string().min(1)).min(1),
    zipArchive: z.boolean().default(true),
});

const deleteSessionsSchema = z.object({
    merged: z.boolean().default(false),
    sessionIds: z.array(z.string().min(1)).min(1),
});

export const listKiroWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listKiroWorkspaceGroups } = await import('@spiracha/lib/kiro-db');
    return listKiroWorkspaceGroups();
});

export const listKiroSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listKiroSessionsForGroup, resolveKiroWorkspaceSessionsDir } = await import('@spiracha/lib/kiro-db');
        return listKiroSessionsForGroup(data.workspaceKey, resolveKiroWorkspaceSessionsDir(), {
            merged: data.merged,
        });
    });

const loadKiroSessionTranscript = async (sessionId: string, merged: boolean) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readKiroSessionTranscript, resolveKiroWorkspaceSessionsDir } = await import('@spiracha/lib/kiro-db');
    const sessionsDir = resolveKiroWorkspaceSessionsDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readKiroSessionTranscript(sessionsDir, sessionId, { merged });
            if (!transcript) {
                throw new Error(`Kiro session not found: ${sessionId}`);
            }

            return transcript;
        },
        {
            id: sessionId,
            integration: 'kiro',
            operation: 'ui-detail',
            path: sessionsDir,
        },
    );
};

export const getKiroSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadKiroSessionTranscript(data.sessionId, data.merged);
    });

export const exportKiroSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderKiroTranscript } = await import('@spiracha/lib/kiro-transcript');
        const transcript = await loadKiroSessionTranscript(data.sessionId, data.merged);
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
            cwd: transcript.session.workspacePath ?? transcript.session.worktree,
            fallbackBaseName: 'kiro-session',
            outputFormat: data.outputFormat,
            sessionId: transcript.session.sessionId,
            updatedAtMs: transcript.session.lastActiveAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportKiroSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderKiroTranscript } = await import('@spiracha/lib/kiro-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadKiroSessionTranscript(sessionId, data.merged);
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
                    cwd: transcript.session.workspacePath ?? transcript.session.worktree,
                    fallbackBaseName: 'kiro-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                    sessionId: transcript.session.sessionId,
                    updatedAtMs: transcript.session.lastActiveAtMs,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'kiro-sessions',
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const deleteKiroSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteKiroSession, resolveKiroWorkspaceSessionsDir } = await import('@spiracha/lib/kiro-db');
        const result = await deleteKiroSession(resolveKiroWorkspaceSessionsDir(), data.sessionId, {
            merged: data.merged,
        });
        requireDeletedItems(result.deletedSessionIds, 'Kiro session', data.sessionId);
        return result;
    });

export const deleteKiroSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteKiroSession, resolveKiroWorkspaceSessionsDir } = await import('@spiracha/lib/kiro-db');
        const sessionsDir = resolveKiroWorkspaceSessionsDir();
        const results = await runDeleteBatch(data.sessionIds, (sessionId) =>
            deleteKiroSession(sessionsDir, sessionId, { merged: data.merged }),
        );
        requireDeletedItems(
            results.flatMap((result) => result.deletedSessionIds),
            'Kiro sessions',
            'batch',
        );
        return {
            deletedFiles: [...new Set(results.flatMap((result) => result.deletedFiles))],
            deletedSessionIds: [...new Set(results.flatMap((result) => result.deletedSessionIds))],
        };
    });
