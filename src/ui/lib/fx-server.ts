import { createServerFn } from '@tanstack/react-start';
import { array, boolean, minLength, object, optional, picklist, pipe, string } from 'valibot';
import { requireDeletedItems, runDeleteBatch } from './delete-batch';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

const workspaceSchema = object({ workspaceKey: pipe(string(), minLength(1)) });
const sessionSchema = object({ sessionId: pipe(string(), minLength(1)) });
const exportOptionsSchema = {
    includeCommentary: optional(boolean(), true),
    includeMetadata: optional(boolean(), true),
    includeTools: optional(boolean(), true),
    outputFormat: optional(picklist(['md', 'txt']), 'md'),
    zipArchive: optional(boolean(), false),
};
const exportSessionSchema = object({ ...exportOptionsSchema, sessionId: pipe(string(), minLength(1)) });
const exportSessionsSchema = object({
    ...exportOptionsSchema,
    sessionIds: pipe(array(pipe(string(), minLength(1))), minLength(1)),
});
const deleteSessionsSchema = object({ sessionIds: pipe(array(pipe(string(), minLength(1))), minLength(1)) });

export const listFxWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listFxWorkspaceGroups } = await import('@spiracha/lib/fx-db');
    return listFxWorkspaceGroups();
});

export const listFxSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listFxSessionsForGroup } = await import('@spiracha/lib/fx-db');
        return listFxSessionsForGroup(data.workspaceKey);
    });

const loadFxSessionTranscript = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readFxSessionTranscript, resolveFxDataDir } = await import('@spiracha/lib/fx-db');
    const dataDir = resolveFxDataDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readFxSessionTranscript(dataDir, sessionId);
            if (!transcript) {
                throw new Error(`FX session not found: ${sessionId}`);
            }
            return transcript;
        },
        { id: sessionId, integration: 'fx', operation: 'ui-detail', path: dataDir },
    );
};

export const getFxSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => loadFxSessionTranscript(data.sessionId));

export const exportFxSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderFxTranscript } = await import('@spiracha/lib/fx-transcript');
        const transcript = await loadFxSessionTranscript(data.sessionId);
        const content = renderFxTranscript(transcript, data);
        if (!content) {
            throw new Error(`FX session has no exportable content: ${data.sessionId}`);
        }
        return renderSourceSessionDownload({
            content,
            cwd: transcript.session.worktree,
            fallbackBaseName: 'fx-session',
            outputFormat: data.outputFormat,
            platform: 'fx',
            sessionId: transcript.session.sessionId,
            updatedAtMs: transcript.session.lastActiveAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportFxSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderFxTranscript } = await import('@spiracha/lib/fx-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadFxSessionTranscript(sessionId);
                const content = renderFxTranscript(transcript, data);
                if (!content) {
                    throw new Error(`FX session has no exportable content: ${sessionId}`);
                }
                return {
                    content,
                    cwd: transcript.session.worktree,
                    fallbackBaseName: 'fx-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                    sessionId: transcript.session.sessionId,
                    updatedAtMs: transcript.session.lastActiveAtMs,
                };
            }),
        );
        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'fx-sessions',
            outputFormat: data.outputFormat,
            platform: 'fx',
            zipArchive: true,
        });
    });

export const deleteFxSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteFxSession, resolveFxDataDir } = await import('@spiracha/lib/fx-db');
        const result = await deleteFxSession(resolveFxDataDir(), data.sessionId);
        requireDeletedItems(result.deletedSessionIds, 'FX session', data.sessionId);
        return result;
    });

export const deleteFxSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteFxSession, resolveFxDataDir } = await import('@spiracha/lib/fx-db');
        const dataDir = resolveFxDataDir();
        const results = await runDeleteBatch(data.sessionIds, (sessionId) => deleteFxSession(dataDir, sessionId));
        requireDeletedItems(
            results.flatMap((result) => result.deletedSessionIds),
            'FX sessions',
            'batch',
        );
        return {
            deletedFiles: [...new Set(results.flatMap((result) => result.deletedFiles))],
            deletedSessionIds: [...new Set(results.flatMap((result) => result.deletedSessionIds))],
        };
    });
