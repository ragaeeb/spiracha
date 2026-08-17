import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
    CursorCleanupRetryPlan,
    CursorCleanupRetryTarget,
    CursorPruneResult,
    CursorWorkspaceGroup,
} from '@spiracha/lib/cursor-exporter-types';
import { isSafeCursorComposerId } from '@spiracha/lib/cursor-id';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

const composerIdSchema = z.string().refine(isSafeCursorComposerId, {
    message: 'Invalid Cursor composer id.',
});

const cleanupRetryTargetSchema = z.object({
    token: z.string().uuid(),
});

const CURSOR_CLEANUP_RETRY_TTL_MS = 5 * 60 * 1000;
const CURSOR_CLEANUP_RETRY_MAX = 128;

const workspaceSchema = z.object({
    workspaceKey: z.string().min(1),
});

const deleteWorkspaceSchema = workspaceSchema.extend({
    retry: cleanupRetryTargetSchema.optional(),
});

const workspacesSchema = z.object({
    retryTargets: z.array(cleanupRetryTargetSchema.nullable()).max(CURSOR_CLEANUP_RETRY_MAX).optional(),
    workspaceKeys: z.array(z.string().min(1)).min(1).max(CURSOR_CLEANUP_RETRY_MAX),
});

// Keep filesystem retry paths server-side; clients receive only bounded, opaque, single-use tokens.
const cursorCleanupRetryPlans = new Map<string, { createdAtMs: number; plan: CursorCleanupRetryPlan }>();

const purgeExpiredCursorCleanupRetryPlans = (nowMs = Date.now()) => {
    for (const [token, record] of cursorCleanupRetryPlans) {
        if (nowMs - record.createdAtMs >= CURSOR_CLEANUP_RETRY_TTL_MS) {
            cursorCleanupRetryPlans.delete(token);
        }
    }
};

const registerCursorCleanupRetryPlan = (plan: CursorCleanupRetryPlan): CursorCleanupRetryTarget => {
    const nowMs = Date.now();
    purgeExpiredCursorCleanupRetryPlans(nowMs);
    while (cursorCleanupRetryPlans.size >= CURSOR_CLEANUP_RETRY_MAX) {
        const oldestToken = cursorCleanupRetryPlans.keys().next().value;
        if (typeof oldestToken !== 'string') {
            break;
        }
        cursorCleanupRetryPlans.delete(oldestToken);
    }

    const token = randomUUID();
    cursorCleanupRetryPlans.set(token, { createdAtMs: nowMs, plan });
    return { token };
};

const resolveCursorCleanupRetryPlan = (target: CursorCleanupRetryTarget): CursorCleanupRetryPlan => {
    purgeExpiredCursorCleanupRetryPlans();
    const record = cursorCleanupRetryPlans.get(target.token);
    if (!record) {
        throw new Error('Cursor cleanup retry token is missing or expired.');
    }

    return record.plan;
};

const consumeCursorCleanupRetryPlan = (
    target: CursorCleanupRetryTarget,
    workspaceKey: string,
): CursorCleanupRetryPlan => {
    const plan = resolveCursorCleanupRetryPlan(target);
    if (plan.workspaceKey !== workspaceKey) {
        throw new Error('Cursor workspace retry target does not match the workspace key.');
    }

    cursorCleanupRetryPlans.delete(target.token);
    return plan;
};

const consumeCursorCleanupRetryPlans = (
    targets: Array<CursorCleanupRetryTarget | null>,
    workspaceKeys: string[],
): Array<CursorCleanupRetryPlan | null> => {
    const plans = targets.map(() => null as CursorCleanupRetryPlan | null);
    const seenTokens = new Set<string>();
    for (const [index, target] of targets.entries()) {
        if (!target) {
            continue;
        }
        if (seenTokens.has(target.token)) {
            throw new Error('Cursor workspace retry targets must not reuse a token in one request.');
        }
        seenTokens.add(target.token);
        const plan = resolveCursorCleanupRetryPlan(target);
        if (plan.workspaceKey !== workspaceKeys[index]) {
            throw new Error('Cursor workspace retry target does not match the workspace key.');
        }
        plans[index] = plan;
    }

    for (const target of targets) {
        if (target) {
            cursorCleanupRetryPlans.delete(target.token);
        }
    }

    return plans;
};

const finalizeCursorPruneResult = (result: CursorPruneResult): CursorPruneResult => {
    const retryPlan = result.retryPlan;
    delete result.retryPlan;
    delete result.retryTarget;
    if (result.cleanupFailures.length > 0 && retryPlan) {
        result.retryTarget = registerCursorCleanupRetryPlan(retryPlan);
    }

    return result;
};

const threadSchema = z.object({
    composerId: composerIdSchema,
});

const recoverSchema = z.object({
    apply: z.boolean().default(false),
    workspaceKey: z.string().min(1),
});

const exportSchema = z.object({
    composerId: composerIdSchema,
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    zipArchive: z.boolean().default(false),
});

const exportThreadsSchema = z.object({
    composerIds: z.array(composerIdSchema).min(1),
    includeCommentary: z.boolean().default(true),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    zipArchive: z.boolean().default(true),
});

const deleteThreadsSchema = z.object({
    composerIds: z.array(composerIdSchema).min(1),
});

const ensureCursorClosedForWrite = async () => {
    const { isCursorRunning } = await import('@spiracha/lib/cursor-recovery');
    if (await isCursorRunning()) {
        throw new Error(
            'Quit Cursor before deleting. It rewrites chat history on exit, which can resurrect deleted threads.',
        );
    }
};

const findGroupByKey = async (workspaceKey: string) => {
    const { listCursorWorkspaceGroups } = await import('@spiracha/lib/cursor-db');
    const groups = await listCursorWorkspaceGroups();
    const group = groups.find((candidate) => candidate.key === workspaceKey);
    if (!group) {
        throw new Error(`Cursor workspace not found: ${workspaceKey}`);
    }

    return group;
};

const findGroupsByKeys = async (workspaceKeys: string[]) => {
    const { listCursorWorkspaceGroups } = await import('@spiracha/lib/cursor-db');
    const groupsByKey = new Map((await listCursorWorkspaceGroups()).map((group) => [group.key, group]));

    return workspaceKeys.map((workspaceKey) => {
        const group = groupsByKey.get(workspaceKey);
        if (!group) {
            throw new Error(`Cursor workspace not found: ${workspaceKey}`);
        }

        return group;
    });
};

const toCleanupFailureMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isCursorSafetyError = (error: unknown): boolean =>
    error instanceof Error && error.message.startsWith('Unsafe Cursor');

const deleteCursorWorkspaceGroup = async (group: CursorWorkspaceGroup) => {
    const { listCursorThreadsForGroup } = await import('@spiracha/lib/cursor-db');
    const {
        collectCursorThreadsForDeletion,
        deleteCursorWorkspaceBuckets,
        deleteCursorWorkspaceHistory,
        pruneCursorThreads,
    } = await import('@spiracha/lib/cursor-recovery');
    const threads = await listCursorThreadsForGroup(group, undefined, { includeTranscriptDirs: false });
    const composerIds = [
        ...new Set([
            ...threads.map((thread) => thread.composerId),
            ...group.buckets.flatMap((bucket) => bucket.threadComposerIds),
        ]),
    ];
    const deletableThreads = composerIds.length === 0 ? [] : await collectCursorThreadsForDeletion(composerIds);
    const result: CursorPruneResult =
        composerIds.length === 0
            ? {
                  bubblesDeleted: 0,
                  cleanupFailures: [],
                  composerDataDeleted: 0,
                  composerIds: [],
                  headersRemoved: 0,
                  transcriptDirsRemoved: 0,
                  transcriptDirsRemovedPaths: [],
                  workspaceBucketsUpdated: 0,
              }
            : await pruneCursorThreads(deletableThreads, true);

    result.cleanupFailures ??= [];
    try {
        const bucketCleanup = await deleteCursorWorkspaceBuckets(group);
        result.workspaceBucketsRemovedPaths = bucketCleanup.removedPaths;
        result.cleanupFailures.push(...bucketCleanup.cleanupFailures);
    } catch (error) {
        if (isCursorSafetyError(error)) {
            throw error;
        }
        result.cleanupFailures.push({
            error: toCleanupFailureMessage(error),
            phase: 'workspace_buckets',
        });
    }
    try {
        const historyCleanup = await deleteCursorWorkspaceHistory(group);
        result.workspaceHistoryRemovedPaths = historyCleanup.removedPaths;
        result.cleanupFailures.push(...historyCleanup.cleanupFailures);
    } catch (error) {
        if (isCursorSafetyError(error)) {
            throw error;
        }
        result.cleanupFailures.push({
            error: toCleanupFailureMessage(error),
            phase: 'workspace_history',
        });
    }
    if (result.cleanupFailures.length > 0) {
        const transcriptFailure = result.cleanupFailures.some((failure) => failure.phase === 'transcript_directory');
        const bucketFailure = result.cleanupFailures.some((failure) => failure.phase === 'workspace_buckets');
        result.retryPlan = {
            bucketPaths: result.cleanupFailures
                .filter((failure) => failure.phase === 'workspace_buckets' && failure.path)
                .map((failure) => failure.path!)
                .concat(
                    bucketFailure &&
                        result.cleanupFailures.some((failure) => failure.phase === 'workspace_buckets' && !failure.path)
                        ? group.buckets.map((bucket) => path.dirname(bucket.workspaceJsonPath))
                        : [],
                ),
            composerIds,
            folders: group.folders,
            historyPaths: result.cleanupFailures
                .filter((failure) => failure.phase === 'workspace_history' && failure.path)
                .map((failure) => failure.path!),
            transcriptDirs: result.cleanupFailures
                .filter((failure) => failure.phase === 'transcript_directory' && failure.path)
                .map((failure) => failure.path!)
                .concat(
                    transcriptFailure &&
                        result.cleanupFailures.some(
                            (failure) => failure.phase === 'transcript_directory' && !failure.path,
                        )
                        ? deletableThreads.flatMap((thread) => thread.transcriptDirs)
                        : [],
                ),
            workspaceKey: group.key,
        };
    }
    return finalizeCursorPruneResult(result);
};

const findCursorWorkspacesByComposerId = async (
    workspaceGroups: CursorWorkspaceGroup[],
    composerIds: string[],
): Promise<Map<string, CursorWorkspaceGroup>> => {
    const requestedIds = new Set(composerIds);
    const workspacesByComposerId = new Map<string, CursorWorkspaceGroup>();
    const { listCursorThreadsForGroup } = await import('@spiracha/lib/cursor-db');

    for (const group of workspaceGroups) {
        const threads = await listCursorThreadsForGroup(group, undefined, { includeTranscriptDirs: false });
        for (const thread of threads) {
            if (requestedIds.has(thread.composerId)) {
                workspacesByComposerId.set(thread.composerId, group);
            }
        }

        if (workspacesByComposerId.size === requestedIds.size) {
            break;
        }
    }

    return workspacesByComposerId;
};

const renderCursorZipDownload = async (
    rendered: Array<{
        composerId: string;
        content: string;
        cwd: string | null;
        fileBaseName: string;
        updatedAtMs: number | null;
    }>,
    outputFormat: 'md' | 'txt',
) => {
    return renderSourceSessionsDownload({
        entries: rendered.map((entry) => ({
            content: entry.content,
            cwd: entry.cwd,
            fallbackBaseName: 'cursor-thread',
            fileBaseName: entry.fileBaseName,
            sessionId: entry.composerId,
            updatedAtMs: entry.updatedAtMs,
        })),
        fallbackBaseName: 'cursor',
        outputFormat,
        platform: 'cursor',
        zipArchive: true,
    });
};

export const findCursorThreadByComposerId = async (composerId: string) => {
    const { listCursorThreadsForGroup, listCursorWorkspaceGroups } = await import('@spiracha/lib/cursor-db');
    for (const group of await listCursorWorkspaceGroups()) {
        const threads = await listCursorThreadsForGroup(group, undefined, { includeTranscriptDirs: false });
        const thread = threads.find((candidate) => candidate.composerId === composerId);
        if (thread) {
            return thread;
        }
    }

    return null;
};

const renderCursorDownload = async (input: {
    composerIds: string[];
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
}) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readCursorThreadTranscriptWithAgentFiles } = await import('@spiracha/lib/cursor-db');
    const { getCursorGlobalDbPath } = await import('@spiracha/lib/cursor-exporter-types');
    const { renderCursorTranscript } = await import('@spiracha/lib/cursor-transcript');
    const globalDbPath = getCursorGlobalDbPath();
    const { findCursorTranscriptDirsForComposerIds, listCursorWorkspaceGroups } = await import(
        '@spiracha/lib/cursor-db'
    );
    const workspaceGroups = await listCursorWorkspaceGroups();
    const workspacesByComposerId = await findCursorWorkspacesByComposerId(workspaceGroups, input.composerIds);
    const transcriptDirsByComposerId = await findCursorTranscriptDirsForComposerIds(input.composerIds);
    const rendered = await Promise.all(
        input.composerIds.map(async (composerId) => {
            const transcript = await runWithTranscriptLoadLimit(
                () =>
                    readCursorThreadTranscriptWithAgentFiles(
                        globalDbPath,
                        composerId,
                        undefined,
                        transcriptDirsByComposerId.get(composerId) ?? [],
                    ),
                {
                    id: composerId,
                    integration: 'cursor',
                    operation: 'ui-export',
                    path: globalDbPath,
                },
            );
            if (!transcript) {
                throw new Error(`No transcript found for thread: ${composerId}`);
            }

            const content = renderCursorTranscript(transcript, {
                includeCommentary: input.includeCommentary,
                includeMetadata: input.includeMetadata,
                includeTools: input.includeTools,
                outputFormat: input.outputFormat,
            });

            if (!content) {
                throw new Error(`Thread has no exportable content: ${composerId}`);
            }

            const workspace = workspacesByComposerId.get(composerId);

            return {
                composerId,
                content,
                cwd: workspace?.folders[0] ?? null,
                fileBaseName: transcript.head.name || composerId,
                updatedAtMs: transcript.head.lastUpdatedAtMs,
            };
        }),
    );

    if (input.zipArchive || rendered.length > 1) {
        return renderCursorZipDownload(rendered, input.outputFormat);
    }

    if (rendered.length === 1) {
        const entry = rendered[0]!;
        return renderSourceSessionDownload({
            content: entry.content,
            cwd: entry.cwd,
            fallbackBaseName: 'cursor-thread',
            outputFormat: input.outputFormat,
            platform: 'cursor',
            sessionId: entry.composerId,
            updatedAtMs: entry.updatedAtMs,
            zipArchive: false,
        });
    }

    throw new Error('No Cursor threads selected for export');
};

export const listCursorWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listCursorWorkspaceGroups } = await import('@spiracha/lib/cursor-db');
    return listCursorWorkspaceGroups();
});

export const listCursorThreadsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listCursorThreadsForGroup } = await import('@spiracha/lib/cursor-db');
        const group = await findGroupByKey(data.workspaceKey);
        return listCursorThreadsForGroup(group, undefined, { includeTranscriptDirs: false });
    });

export const getCursorThreadDetailFn = createServerFn({ method: 'GET' })
    .validator(threadSchema)
    .handler(async ({ data }) => {
        const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
        const { readCursorThreadTranscriptWithAgentFiles } = await import('@spiracha/lib/cursor-db');
        const { getCursorGlobalDbPath } = await import('@spiracha/lib/cursor-exporter-types');
        const thread = await findCursorThreadByComposerId(data.composerId);
        if (!thread) {
            throw new Error(`Cursor thread not found: ${data.composerId}`);
        }

        const transcript = await runWithTranscriptLoadLimit(
            () => readCursorThreadTranscriptWithAgentFiles(getCursorGlobalDbPath(), data.composerId),
            {
                id: data.composerId,
                integration: 'cursor',
                operation: 'ui-detail',
                path: getCursorGlobalDbPath(),
            },
        );
        return {
            thread,
            transcript,
        };
    });

export const exportCursorThreadFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        return await renderCursorDownload({
            composerIds: [data.composerId],
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const exportCursorThreadsFn = createServerFn({ method: 'POST' })
    .validator(exportThreadsSchema)
    .handler(async ({ data }) => {
        return await renderCursorDownload({
            composerIds: data.composerIds,
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
            zipArchive: data.zipArchive,
        });
    });

export const recoverCursorWorkspaceFn = createServerFn({ method: 'POST' })
    .validator(recoverSchema)
    .handler(async ({ data }) => {
        const { isCursorRunning, recoverCursorWorkspaceGroup } = await import('@spiracha/lib/cursor-recovery');
        const group = await findGroupByKey(data.workspaceKey);
        // Cursor rewrites composer.composerHeaders on exit, so a write while it is running gets
        // clobbered. Refuse to apply until Cursor is closed.
        if (data.apply && (await isCursorRunning())) {
            throw new Error('Quit Cursor before recovering. It overwrites chat history on exit, undoing the recovery.');
        }

        return recoverCursorWorkspaceGroup(group, data.apply);
    });

export const deleteCursorThreadsFn = createServerFn({ method: 'POST' })
    .validator(deleteThreadsSchema)
    .handler(async ({ data }) => {
        const { collectCursorThreadsForDeletion, pruneCursorThreads } = await import('@spiracha/lib/cursor-recovery');
        await ensureCursorClosedForWrite();
        const threads = await collectCursorThreadsForDeletion(data.composerIds);
        return pruneCursorThreads(threads, true);
    });

export const deleteCursorWorkspaceFn = createServerFn({ method: 'POST' })
    .validator(deleteWorkspaceSchema)
    .handler(async ({ data }) => {
        await ensureCursorClosedForWrite();
        if (data.retry) {
            const retryPlan = consumeCursorCleanupRetryPlan(data.retry, data.workspaceKey);
            const { retryCursorWorkspaceCleanup } = await import('@spiracha/lib/cursor-recovery');
            return finalizeCursorPruneResult(await retryCursorWorkspaceCleanup(retryPlan));
        }
        const group = await findGroupByKey(data.workspaceKey);
        return deleteCursorWorkspaceGroup(group);
    });

export const deleteCursorWorkspacesFn = createServerFn({ method: 'POST' })
    .validator(workspacesSchema)
    .handler(async ({ data }) => {
        await ensureCursorClosedForWrite();
        const retryTargets = data.retryTargets ?? [];
        if (retryTargets.length > 0 && retryTargets.length !== data.workspaceKeys.length) {
            throw new Error('Cursor workspace retry targets must match the workspace key count.');
        }
        const retryPlans = consumeCursorCleanupRetryPlans(retryTargets, data.workspaceKeys);
        const groupKeys = data.workspaceKeys.filter((_workspaceKey, index) => !retryPlans[index]);
        const groupsByKey = new Map((await findGroupsByKeys(groupKeys)).map((group) => [group.key, group]));
        const results: CursorPruneResult[] = [];
        for (const [index, workspaceKey] of data.workspaceKeys.entries()) {
            const retryTarget = retryTargets[index];
            const retryPlan = retryPlans[index];
            if (retryTarget && retryPlan) {
                const { retryCursorWorkspaceCleanup } = await import('@spiracha/lib/cursor-recovery');
                results.push(finalizeCursorPruneResult(await retryCursorWorkspaceCleanup(retryPlan)));
                continue;
            }
            results.push(await deleteCursorWorkspaceGroup(groupsByKey.get(workspaceKey)!));
        }

        return results;
    });
