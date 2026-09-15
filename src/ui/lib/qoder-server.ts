import { createServerFn } from '@tanstack/react-start';
import { array, boolean, minLength, object, optional, picklist, pipe, string } from 'valibot';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

const workspaceSchema = object({
    workspaceKey: pipe(string(), minLength(1)),
});

const sessionSchema = object({
    sessionId: pipe(string(), minLength(1)),
});

const exportSessionSchema = object({
    includeCommentary: optional(boolean(), true),
    includeMetadata: optional(boolean(), true),
    includeTools: optional(boolean(), true),
    outputFormat: optional(picklist(['md', 'txt']), 'md'),
    sessionId: pipe(string(), minLength(1)),
    zipArchive: optional(boolean(), false),
});

const exportSessionsSchema = object({
    includeCommentary: optional(boolean(), true),
    includeMetadata: optional(boolean(), true),
    includeTools: optional(boolean(), true),
    outputFormat: optional(picklist(['md', 'txt']), 'md'),
    sessionIds: pipe(array(pipe(string(), minLength(1))), minLength(1)),
    zipArchive: optional(boolean(), true),
});

export const listQoderWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listQoderWorkspaceGroups } = await import('@spiracha/lib/qoder-sessions');
    return listQoderWorkspaceGroups();
});

export const listQoderSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listQoderSessionsForGroup } = await import('@spiracha/lib/qoder-sessions');
        return listQoderSessionsForGroup(data.workspaceKey);
    });

const loadQoderSessionTranscript = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readQoderSessionTranscript } = await import('@spiracha/lib/qoder-session-transcript');
    const { resolveQoderGlobalStateDb, resolveQoderWorkspaceStorageDir } = await import(
        '@spiracha/lib/qoder-exporter-types'
    );
    const globalStateDb = resolveQoderGlobalStateDb();
    const workspaceStorageDir = resolveQoderWorkspaceStorageDir();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readQoderSessionTranscript(globalStateDb, workspaceStorageDir, sessionId);
            if (!transcript) {
                throw new Error(`Qoder session not found: ${sessionId}`);
            }

            return transcript;
        },
        {
            id: sessionId,
            integration: 'qoder',
            operation: 'ui-detail',
            path: globalStateDb,
        },
    );
};

export const getQoderSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadQoderSessionTranscript(data.sessionId);
    });

export const exportQoderSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderQoderTranscript } = await import('@spiracha/lib/qoder-transcript');
        const transcript = await loadQoderSessionTranscript(data.sessionId);
        const content = renderQoderTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });

        if (!content) {
            throw new Error(`Qoder session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            cwd: transcript.session.workspacePath ?? transcript.session.worktree,
            fallbackBaseName: 'qoder-session',
            outputFormat: data.outputFormat,
            platform: 'qoder',
            sessionId: transcript.session.sessionId,
            updatedAtMs: transcript.session.lastActiveAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportQoderSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderQoderTranscript } = await import('@spiracha/lib/qoder-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadQoderSessionTranscript(sessionId);
                const content = renderQoderTranscript(transcript, {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                });

                if (!content) {
                    throw new Error(`Qoder session has no exportable content: ${sessionId}`);
                }

                return {
                    content,
                    cwd: transcript.session.workspacePath ?? transcript.session.worktree,
                    fallbackBaseName: 'qoder-session',
                    fileBaseName: transcript.session.title || transcript.session.sessionId,
                    sessionId: transcript.session.sessionId,
                    updatedAtMs: transcript.session.lastActiveAtMs,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'qoder-sessions',
            outputFormat: data.outputFormat,
            platform: 'qoder',
            zipArchive: data.zipArchive,
        });
    });
