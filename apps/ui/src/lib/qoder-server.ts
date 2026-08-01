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

export const listQoderWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listQoderWorkspaceGroups } = await import('@spiracha/lib/qoder-db');
    return listQoderWorkspaceGroups();
});

export const listQoderSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listQoderSessionsForGroup } = await import('@spiracha/lib/qoder-db');
        return listQoderSessionsForGroup(data.workspaceKey);
    });

const loadQoderSessionTranscript = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readQoderSessionTranscript, resolveQoderGlobalStateDb, resolveQoderWorkspaceStorageDir } = await import(
        '@spiracha/lib/qoder-db'
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
            zipArchive: data.zipArchive,
        });
    });
