import { randomUUID } from 'node:crypto';
import type {
    DeleteOpenCodeWorkspaceResult,
    OpenCodeWorkspaceCleanupRetryPlan,
} from '@spiracha/lib/opencode-exporter-types';
import { createServerFn } from '@tanstack/react-start';
import {
    array,
    boolean,
    maxLength,
    minLength,
    nullable,
    object,
    optional,
    picklist,
    pipe,
    string,
    uuid,
} from 'valibot';
import { requireDeletedItems, runDeleteBatch } from './delete-batch';
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

const deleteSessionsSchema = object({
    sessionIds: pipe(array(pipe(string(), minLength(1))), minLength(1)),
});

const cleanupRetryTargetSchema = object({
    token: pipe(string(), uuid()),
});

const deleteWorkspaceSchema = object({
    retry: optional(cleanupRetryTargetSchema),
    workspaceKey: pipe(string(), minLength(1)),
});

const deleteWorkspacesSchema = object({
    retryTargets: optional(pipe(array(nullable(cleanupRetryTargetSchema)), maxLength(128))),
    workspaceKeys: pipe(array(pipe(string(), minLength(1))), minLength(1), maxLength(128)),
});

const OPENCODE_CLEANUP_RETRY_TTL_MS = 5 * 60 * 1000;
const OPENCODE_CLEANUP_RETRY_MAX = 128;

type OpenCodeCleanupRetryTarget = {
    token: string;
};

type OpenCodeWorkspaceDeleteResponse = Omit<DeleteOpenCodeWorkspaceResult, 'cleanupRetryPlan'> & {
    retryTarget?: OpenCodeCleanupRetryTarget;
};

const openCodeCleanupRetryPlans = new Map<string, { createdAtMs: number; plan: OpenCodeWorkspaceCleanupRetryPlan }>();

const purgeExpiredOpenCodeCleanupRetryPlans = (nowMs = Date.now()) => {
    for (const [token, record] of openCodeCleanupRetryPlans) {
        if (nowMs - record.createdAtMs >= OPENCODE_CLEANUP_RETRY_TTL_MS) {
            openCodeCleanupRetryPlans.delete(token);
        }
    }
};

const registerOpenCodeCleanupRetryPlan = (plan: OpenCodeWorkspaceCleanupRetryPlan): OpenCodeCleanupRetryTarget => {
    const nowMs = Date.now();
    purgeExpiredOpenCodeCleanupRetryPlans(nowMs);
    while (openCodeCleanupRetryPlans.size >= OPENCODE_CLEANUP_RETRY_MAX) {
        const oldestToken = openCodeCleanupRetryPlans.keys().next().value;
        if (typeof oldestToken !== 'string') {
            break;
        }
        openCodeCleanupRetryPlans.delete(oldestToken);
    }

    const token = randomUUID();
    openCodeCleanupRetryPlans.set(token, { createdAtMs: nowMs, plan });
    return { token };
};

const consumeOpenCodeCleanupRetryPlan = (
    target: OpenCodeCleanupRetryTarget,
    workspaceKey: string,
): OpenCodeWorkspaceCleanupRetryPlan => {
    purgeExpiredOpenCodeCleanupRetryPlans();
    const record = openCodeCleanupRetryPlans.get(target.token);
    if (!record) {
        throw new Error('OpenCode cleanup retry token is missing or expired.');
    }
    if (record.plan.workspaceKey !== workspaceKey) {
        throw new Error('OpenCode workspace retry target does not match the workspace key.');
    }

    openCodeCleanupRetryPlans.delete(target.token);
    return record.plan;
};

const finalizeOpenCodeWorkspaceDelete = (result: DeleteOpenCodeWorkspaceResult): OpenCodeWorkspaceDeleteResponse => {
    const { cleanupRetryPlan: retryPlan, ...publicResult } = result;
    if (retryPlan && result.cleanupFailures.length > 0) {
        return { ...publicResult, retryTarget: registerOpenCodeCleanupRetryPlan(retryPlan) };
    }
    return publicResult;
};

const deleteOpenCodeWorkspaceWithRetry = async (
    workspaceKey: string,
    retryTarget?: OpenCodeCleanupRetryTarget,
): Promise<DeleteOpenCodeWorkspaceResult> => {
    if (retryTarget) {
        const plan = consumeOpenCodeCleanupRetryPlan(retryTarget, workspaceKey);
        const { deleteOpenCodeDesktopSessionStateWithResult } = await import('@spiracha/lib/opencode-db');
        const cleanup = await deleteOpenCodeDesktopSessionStateWithResult(plan.sessionIds, undefined, plan.worktrees);
        return {
            cleanupFailures: cleanup.cleanupFailures,
            ...(cleanup.cleanupFailures.length > 0 ? { cleanupRetryPlan: plan } : {}),
            deletedProjectIds: [],
            deletedSessionIds: [],
            workspaceFound: true,
            workspaceKey,
        };
    }

    const { deleteOpenCodeWorkspace, resolveOpenCodeDbPath } = await import('@spiracha/lib/opencode-db');
    return deleteOpenCodeWorkspace(resolveOpenCodeDbPath(), workspaceKey);
};

const toOpenCodeDeleteError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const listOpenCodeWorkspacesFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listOpenCodeWorkspaceGroups } = await import('@spiracha/lib/opencode-db');
    return listOpenCodeWorkspaceGroups();
});

export const listOpenCodeSessionsFn = createServerFn({ method: 'GET' })
    .validator(workspaceSchema)
    .handler(async ({ data }) => {
        const { listOpenCodeSessionsForGroup } = await import('@spiracha/lib/opencode-db');
        return listOpenCodeSessionsForGroup(data.workspaceKey);
    });

const loadOpenCodeSessionTranscript = async (sessionId: string) => {
    const { runWithTranscriptLoadLimit } = await import('@spiracha/lib/transcript-load-limiter');
    const { readOpenCodeSessionTranscript, resolveOpenCodeDbPath } = await import('@spiracha/lib/opencode-db');
    const dbPath = resolveOpenCodeDbPath();
    return runWithTranscriptLoadLimit(
        async () => {
            const transcript = await readOpenCodeSessionTranscript(dbPath, sessionId);
            if (!transcript) {
                throw new Error(`OpenCode session not found: ${sessionId}`);
            }

            return transcript;
        },
        {
            id: sessionId,
            integration: 'opencode',
            operation: 'ui-detail',
            path: dbPath,
        },
    );
};

export const getOpenCodeSessionDetailFn = createServerFn({ method: 'GET' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        return loadOpenCodeSessionTranscript(data.sessionId);
    });

export const exportOpenCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(exportSessionSchema)
    .handler(async ({ data }) => {
        const { renderOpenCodeTranscript } = await import('@spiracha/lib/opencode-transcript');
        const transcript = await loadOpenCodeSessionTranscript(data.sessionId);
        const content = renderOpenCodeTranscript(transcript, {
            includeCommentary: data.includeCommentary,
            includeMetadata: data.includeMetadata,
            includeTools: data.includeTools,
            outputFormat: data.outputFormat,
        });

        if (!content) {
            throw new Error(`OpenCode session has no exportable content: ${data.sessionId}`);
        }

        return renderSourceSessionDownload({
            content,
            cwd: transcript.session.worktree,
            fallbackBaseName: 'opencode-session',
            outputFormat: data.outputFormat,
            platform: 'opencode',
            sessionId: transcript.session.sessionId,
            updatedAtMs: transcript.session.lastUpdatedAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportOpenCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(exportSessionsSchema)
    .handler(async ({ data }) => {
        const { renderOpenCodeTranscript } = await import('@spiracha/lib/opencode-transcript');
        const entries = await Promise.all(
            data.sessionIds.map(async (sessionId) => {
                const transcript = await loadOpenCodeSessionTranscript(sessionId);
                const content = renderOpenCodeTranscript(transcript, {
                    includeCommentary: data.includeCommentary,
                    includeMetadata: data.includeMetadata,
                    includeTools: data.includeTools,
                    outputFormat: data.outputFormat,
                });

                if (!content) {
                    throw new Error(`OpenCode session has no exportable content: ${sessionId}`);
                }

                return {
                    content,
                    cwd: transcript.session.worktree,
                    fallbackBaseName: 'opencode-session',
                    fileBaseName: transcript.session.title || transcript.session.slug || transcript.session.sessionId,
                    sessionId: transcript.session.sessionId,
                    updatedAtMs: transcript.session.lastUpdatedAtMs,
                };
            }),
        );

        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'opencode-sessions',
            outputFormat: data.outputFormat,
            platform: 'opencode',
            zipArchive: data.zipArchive,
        });
    });

export const deleteOpenCodeSessionFn = createServerFn({ method: 'POST' })
    .validator(sessionSchema)
    .handler(async ({ data }) => {
        const { deleteOpenCodeSession, resolveOpenCodeDbPath } = await import('@spiracha/lib/opencode-db');
        const result = await deleteOpenCodeSession(resolveOpenCodeDbPath(), data.sessionId);
        requireDeletedItems(result.deletedSessionIds, 'OpenCode session', data.sessionId);
        return result;
    });

export const deleteOpenCodeSessionsFn = createServerFn({ method: 'POST' })
    .validator(deleteSessionsSchema)
    .handler(async ({ data }) => {
        const { deleteOpenCodeSession, resolveOpenCodeDbPath } = await import('@spiracha/lib/opencode-db');
        const dbPath = resolveOpenCodeDbPath();
        const results = await runDeleteBatch(data.sessionIds, (sessionId) => deleteOpenCodeSession(dbPath, sessionId));
        requireDeletedItems(
            results.flatMap((result) => result.deletedSessionIds),
            'OpenCode sessions',
            'batch',
        );
        return {
            deletedSessionIds: [...new Set(results.flatMap((result) => result.deletedSessionIds))],
        };
    });

export const deleteOpenCodeWorkspaceFn = createServerFn({ method: 'POST' })
    .validator(deleteWorkspaceSchema)
    .handler(async ({ data }) => {
        const result = finalizeOpenCodeWorkspaceDelete(
            await deleteOpenCodeWorkspaceWithRetry(data.workspaceKey, data.retry),
        );
        if (!result.workspaceFound) {
            throw new Error(`OpenCode workspace not found: ${data.workspaceKey}`);
        }
        return result;
    });

export const deleteOpenCodeWorkspacesFn = createServerFn({ method: 'POST' })
    .validator(deleteWorkspacesSchema)
    .handler(async ({ data }) => {
        const retryTargets = data.retryTargets ?? [];
        if (retryTargets.length > 0 && retryTargets.length !== data.workspaceKeys.length) {
            throw new Error('OpenCode workspace retry targets must match the workspace key count.');
        }

        const seenKeys = new Set<string>();
        const workspaceKeys: string[] = [];
        const normalizedRetryTargets: Array<{ token: string } | null> = [];
        for (const [index, workspaceKey] of data.workspaceKeys.entries()) {
            if (seenKeys.has(workspaceKey)) {
                continue;
            }
            seenKeys.add(workspaceKey);
            workspaceKeys.push(workspaceKey);
            normalizedRetryTargets.push(retryTargets[index] ?? null);
        }

        const results: OpenCodeWorkspaceDeleteResponse[] = [];
        const failures: Array<{ error: string; workspaceKey: string }> = [];
        for (const [index, workspaceKey] of workspaceKeys.entries()) {
            try {
                const result = finalizeOpenCodeWorkspaceDelete(
                    await deleteOpenCodeWorkspaceWithRetry(workspaceKey, normalizedRetryTargets[index] ?? undefined),
                );
                if (!result.workspaceFound) {
                    throw new Error(`OpenCode workspace not found: ${workspaceKey}`);
                }
                results.push(result);
            } catch (error) {
                failures.push({ error: toOpenCodeDeleteError(error), workspaceKey });
            }
        }

        return { failures, results };
    });
