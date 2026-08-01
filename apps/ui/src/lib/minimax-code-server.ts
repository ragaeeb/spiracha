import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireDeletedItems, runDeleteBatch } from './delete-batch';
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

export const listMiniMaxCodeWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listMiniMaxCodeWorkspaceGroups } = await import('@spiracha/lib/minimax-code-db');
    return listMiniMaxCodeWorkspaceGroups();
});

export const listMiniMaxCodeSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listMiniMaxCodeSessionsForGroup } = await import('@spiracha/lib/minimax-code-db');
        return listMiniMaxCodeSessionsForGroup(data.workspaceKey);
    });

const loadMiniMaxCodeSessionTranscript = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readMiniMaxCodeSessionTranscript, resolveMiniMaxCodeSessionsDir } = await import(
        '@spiracha/lib/minimax-code-db'
    );
    const sessionsDir = resolveMiniMaxCodeSessionsDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readMiniMaxCodeSessionTranscript(sessionsDir, sessionId);
            if (!transcript) {
                throw new Error(`MiniMax Code session not found: ${sessionId}`);
            }
            return transcript;
        },
        {
            id: sessionId,
            integration: 'minimax-code',
            operation: 'ui-detail',
            path: sessionsDir,
        },
    );
};

export const getMiniMaxCodeSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => loadMiniMaxCodeSessionTranscript(data.sessionId));

export const exportMiniMaxCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderMiniMaxCodeTranscript } = await import('@spiracha/lib/minimax-code-transcript');
        const transcript = await loadMiniMaxCodeSessionTranscript(data.sessionId);
        const content = renderMiniMaxCodeTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });
        if (!content) {
            throw new Error(`MiniMax Code session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            cwd: transcript.session.worktree,
            fallbackBaseName: 'minimax-code-session',
            outputFormat: data.outputFormat,
            sessionId: transcript.session.sessionId,
            updatedAtMs: transcript.session.lastActiveAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportMiniMaxCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderMiniMaxCodeTranscript } = await import('@spiracha/lib/minimax-code-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadMiniMaxCodeSessionTranscript(sessionId);
                const content = renderMiniMaxCodeTranscript(transcript, {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                });
                if (!content) {
                    throw new Error(`MiniMax Code session has no exportable content: ${sessionId}`);
                }

                return {
                    content,
                    cwd: transcript.session.worktree,
                    fallbackBaseName: 'minimax-code-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                    sessionId: transcript.session.sessionId,
                    updatedAtMs: transcript.session.lastActiveAtMs,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'minimax-code-sessions',
            outputFormat: data.outputFormat,
            zipArchive: true,
        });
    });

export const deleteMiniMaxCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteMiniMaxCodeSession, resolveMiniMaxCodeRuntimeDbPath, resolveMiniMaxCodeSessionsDir } =
            await import('@spiracha/lib/minimax-code-db');
        const sessionsDir = resolveMiniMaxCodeSessionsDir();
        const result = await deleteMiniMaxCodeSession(
            sessionsDir,
            resolveMiniMaxCodeRuntimeDbPath(sessionsDir),
            data.sessionId,
        );
        requireDeletedItems(result.deletedSessionIds, 'MiniMax Code session', data.sessionId);
        return result;
    });

export const deleteMiniMaxCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteMiniMaxCodeSession, resolveMiniMaxCodeRuntimeDbPath, resolveMiniMaxCodeSessionsDir } =
            await import('@spiracha/lib/minimax-code-db');
        const sessionsDir = resolveMiniMaxCodeSessionsDir();
        const runtimeDbPath = resolveMiniMaxCodeRuntimeDbPath(sessionsDir);
        const results = await runDeleteBatch(data.sessionIds, (sessionId) =>
            deleteMiniMaxCodeSession(sessionsDir, runtimeDbPath, sessionId),
        );
        requireDeletedItems(
            results.flatMap((result) => result.deletedSessionIds),
            'MiniMax Code sessions',
            'batch',
        );
        return {
            deletedFiles: [...new Set(results.flatMap((result) => result.deletedFiles))],
            deletedSessionIds: [...new Set(results.flatMap((result) => result.deletedSessionIds))],
        };
    });
