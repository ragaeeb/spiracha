import { getCodexAnalytics } from '@spiracha/lib/codex-analytics';
import {
    deleteCodexProject,
    deleteCodexThread,
    deleteCodexThreads,
    getCodexDashboardSummary,
    getThreadBrowseData,
    listCodexProjects,
    listProjectThreads,
    resolveCodexThreadDbPath,
} from '@spiracha/lib/codex-browser-db';
import { renderCodexThreadDownload, renderCodexThreadsDownload } from '@spiracha/lib/codex-browser-export';
import {
    getCachedParsedCodexTranscript,
    getCachedThreadTranscriptPreview,
    getThreadRolloutLoadState,
} from '@spiracha/lib/codex-thread-cache';
import { recoverCodexProjectThreads } from '@spiracha/lib/codex-thread-recovery';
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

const getDbPath = () => process.env.SPIRACHA_CODEX_DB?.trim() || resolveCodexThreadDbPath();

const isMissingFileError = (error: unknown) => {
    return error instanceof Error && /ENOENT|no such file/i.test(error.message);
};

export const getDashboardSummaryFn = createServerFn({ method: 'GET' }).handler(async () => {
    return getCodexDashboardSummary(getDbPath());
});

export const listProjectsFn = createServerFn({ method: 'GET' }).handler(async () => {
    return listCodexProjects(getDbPath());
});

export const listProjectThreadsFn = createServerFn({ method: 'GET' })
    .validator(projectSchema)
    .handler(async ({ data }) => {
        return listProjectThreads(getDbPath(), data.project);
    });

export const getThreadSnapshotFn = createServerFn({ method: 'GET' })
    .validator(threadSchema)
    .handler(async ({ data }) => {
        const dbPath = getDbPath();
        const browseData = getThreadBrowseData(dbPath, data.threadId);
        const rollout = await getThreadRolloutLoadState(browseData.thread.rollout_path);
        let transcript = null;
        let transcriptState: 'available' | 'deferred' | 'missing' = rollout.shouldDeferTranscriptLoad
            ? 'deferred'
            : 'available';

        if (!rollout.shouldDeferTranscriptLoad) {
            try {
                transcript = await getCachedParsedCodexTranscript(browseData.thread.rollout_path);
            } catch (error) {
                if (!isMissingFileError(error)) {
                    throw error;
                }

                transcriptState = 'missing';
            }
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

export const getThreadTranscriptFn = createServerFn({ method: 'GET' })
    .validator(threadSchema)
    .handler(async ({ data }) => {
        const dbPath = getDbPath();
        const browseData = getThreadBrowseData(dbPath, data.threadId);
        return getCachedThreadTranscriptPreview(browseData.thread.rollout_path);
    });

export const getAnalyticsFn = createServerFn({ method: 'GET' })
    .validator(analyticsSchema)
    .handler(async ({ data }) => {
        return getCodexAnalytics({
            dbPath: getDbPath(),
            project: data.project,
        });
    });

export const exportThreadFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        return renderCodexThreadDownload({
            dbPath: getDbPath(),
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
        return renderCodexThreadsDownload({
            dbPath: getDbPath(),
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            pathDisplaySettings: {
                convertToProjectRoot: data.convertToProjectRoot,
                redactUsername: data.redactUsername,
            },
            threadIds: data.threadIds,
        });
    });

export const deleteThreadFn = createServerFn({ method: 'POST' })
    .validator(deleteThreadSchema)
    .handler(async ({ data }) => {
        return deleteCodexThread(getDbPath(), data.threadId, {
            deleteSessionFiles: data.deleteSessionFiles,
        });
    });

export const deleteThreadsFn = createServerFn({ method: 'POST' })
    .validator(deleteThreadsSchema)
    .handler(async ({ data }) => {
        return deleteCodexThreads(getDbPath(), data.threadIds, {
            deleteSessionFiles: data.deleteSessionFiles,
        });
    });

export const deleteProjectFn = createServerFn({ method: 'POST' })
    .validator(deleteProjectSchema)
    .handler(async ({ data }) => {
        return deleteCodexProject(getDbPath(), data.project, {
            deleteSessionFiles: data.deleteSessionFiles,
        });
    });

export const recoverProjectThreadsFn = createServerFn({ method: 'POST' })
    .validator(projectSchema)
    .handler(async ({ data }) => {
        return recoverCodexProjectThreads(getDbPath(), data.project);
    });
