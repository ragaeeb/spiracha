import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const projectSchema = z.object({
    project: z.string().min(1),
});

const deleteProjectSchema = z.object({
    deleteSessionFiles: z.boolean().default(false),
    project: z.string().min(1),
});

const threadSchema = z.object({
    threadId: z.string().min(1),
});

const transcriptFiltersSchema = z.object({
    showCommentary: z.boolean(),
    showExtraEvents: z.boolean(),
    showToolCalls: z.boolean(),
    showUserMessages: z.boolean(),
});

const threadSnapshotSchema = z.object({
    filters: transcriptFiltersSchema.optional(),
    threadId: z.string().min(1),
});

const deleteThreadSchema = z.object({
    deleteSessionFiles: z.boolean().default(false),
    threadId: z.string().min(1),
});

const deleteThreadsSchema = z.object({
    deleteSessionFiles: z.boolean().default(false),
    threadIds: z.array(z.string().min(1)).min(1),
});

const analyticsSchema = z.object({
    project: z.string().min(1).nullable(),
});

const exportSchema = z.object({
    convertToProjectRoot: z.boolean(),
    includeCommentary: z.boolean(),
    includeMetadata: z.boolean(),
    includeTools: z.boolean(),
    outputFormat: z.enum(['md', 'txt']),
    redactUsername: z.boolean(),
    threadId: z.string().min(1),
    zipArchive: z.boolean().default(false),
});

const exportThreadsSchema = z.object({
    convertToProjectRoot: z.boolean(),
    includeCommentary: z.boolean(),
    includeMetadata: z.boolean(),
    includeTools: z.boolean(),
    outputFormat: z.enum(['md', 'txt']),
    redactUsername: z.boolean(),
    threadIds: z.array(z.string().min(1)).min(1),
    zipArchive: z.boolean().default(true),
});

const getDbPath = async () => {
    const configuredDbPath = process.env.SPIRACHA_CODEX_DB?.trim();
    if (configuredDbPath) {
        return configuredDbPath;
    }

    const { resolveCodexThreadDbPath } = await import('@spiracha/lib/codex-browser-db');
    return resolveCodexThreadDbPath();
};

const isMissingFileError = (error: unknown) => {
    return error instanceof Error && /ENOENT|no such file/i.test(error.message);
};

export const getDashboardSummaryFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { getCodexDashboardSummary } = await import('@spiracha/lib/codex-browser-db');
    return getCodexDashboardSummary(await getDbPath());
});

export const listProjectsFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listCodexProjects } = await import('@spiracha/lib/codex-browser-db');
    return listCodexProjects(await getDbPath());
});

export const listProjectThreadsFn = createServerFn({ method: 'GET' })
    .validator(projectSchema)
    .handler(async ({ data }) => {
        const { listProjectThreads } = await import('@spiracha/lib/codex-browser-db');
        return listProjectThreads(await getDbPath(), data.project, {
            includeTranscriptStats: false,
        });
    });

export const getThreadSnapshotFn = createServerFn({ method: 'GET' })
    .validator(threadSnapshotSchema)
    .handler(async ({ data }) => {
        const [
            { getThreadBrowseData },
            { getCachedParsedCodexTranscript, getCachedThreadTranscriptPreview, getThreadRolloutLoadState },
        ] = await Promise.all([import('@spiracha/lib/codex-browser-db'), import('@spiracha/lib/codex-thread-cache')]);
        const dbPath = await getDbPath();
        const browseData = getThreadBrowseData(dbPath, data.threadId);
        const rollout = await getThreadRolloutLoadState(browseData.thread.rollout_path);
        let transcript = null;
        let transcriptState: 'available' | 'deferred' | 'missing' = rollout.shouldDeferTranscriptLoad
            ? 'deferred'
            : 'available';

        try {
            if (rollout.shouldDeferTranscriptLoad) {
                transcript = await getCachedThreadTranscriptPreview(browseData.thread.rollout_path, {
                    filters: data.filters,
                });
            } else {
                transcript = await getCachedParsedCodexTranscript(browseData.thread.rollout_path);
            }
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }

            transcript = null;
            transcriptState = 'missing';
        }

        return {
            ...browseData,
            availableTools:
                browseData.dynamicTools.length > 0
                    ? browseData.dynamicTools
                    : (transcript?.sessionMeta.dynamicTools ?? []),
            rollout,
            transcript,
            transcriptState,
        };
    });

export const loadThreadTranscript = async (threadId: string) => {
    const [{ getThreadBrowseData }, { getCachedParsedCodexTranscript }] = await Promise.all([
        import('@spiracha/lib/codex-browser-db'),
        import('@spiracha/lib/codex-thread-cache'),
    ]);
    const dbPath = await getDbPath();
    const browseData = getThreadBrowseData(dbPath, threadId);
    return getCachedParsedCodexTranscript(browseData.thread.rollout_path);
};

export const getThreadTranscriptFn = createServerFn({ method: 'GET' })
    .validator(threadSchema)
    .handler(async ({ data }) => {
        return loadThreadTranscript(data.threadId);
    });

export const getAnalyticsFn = createServerFn({ method: 'GET' })
    .validator(analyticsSchema)
    .handler(async ({ data }) => {
        const { getCodexAnalytics } = await import('@spiracha/lib/codex-analytics');
        return getCodexAnalytics({
            dbPath: await getDbPath(),
            project: data.project,
        });
    });

export const exportThreadFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        const { renderCodexThreadDownload } = await import('@spiracha/lib/codex-browser-export');
        return renderCodexThreadDownload({
            dbPath: await getDbPath(),
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            pathDisplaySettings: {
                convertToProjectRoot: data.convertToProjectRoot,
                redactUsername: data.redactUsername,
            },
            threadId: data.threadId,
            zipArchive: data.zipArchive,
        });
    });

export const exportThreadsFn = createServerFn({ method: 'POST' })
    .validator(exportThreadsSchema)
    .handler(async ({ data }) => {
        const { renderCodexThreadsDownload } = await import('@spiracha/lib/codex-browser-export');
        return renderCodexThreadsDownload({
            dbPath: await getDbPath(),
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            pathDisplaySettings: {
                convertToProjectRoot: data.convertToProjectRoot,
                redactUsername: data.redactUsername,
            },
            threadIds: data.threadIds,
            zipArchive: data.zipArchive,
        });
    });

export const deleteThreadFn = createServerFn({ method: 'POST' })
    .validator(deleteThreadSchema)
    .handler(async ({ data }) => {
        const { deleteCodexThread } = await import('@spiracha/lib/codex-browser-db');
        return deleteCodexThread(await getDbPath(), data.threadId, {
            deleteSessionFiles: data.deleteSessionFiles,
        });
    });

export const deleteThreadsFn = createServerFn({ method: 'POST' })
    .validator(deleteThreadsSchema)
    .handler(async ({ data }) => {
        const { deleteCodexThreads } = await import('@spiracha/lib/codex-browser-db');
        return deleteCodexThreads(await getDbPath(), data.threadIds, {
            deleteSessionFiles: data.deleteSessionFiles,
        });
    });

export const deleteProjectFn = createServerFn({ method: 'POST' })
    .validator(deleteProjectSchema)
    .handler(async ({ data }) => {
        const { deleteCodexProject } = await import('@spiracha/lib/codex-browser-db');
        return deleteCodexProject(await getDbPath(), data.project, {
            deleteSessionFiles: data.deleteSessionFiles,
        });
    });

export const recoverProjectThreadsFn = createServerFn({ method: 'POST' })
    .validator(projectSchema)
    .handler(async ({ data }) => {
        const { recoverCodexProjectThreads } = await import('@spiracha/lib/codex-thread-recovery');
        return recoverCodexProjectThreads(await getDbPath(), data.project);
    });
