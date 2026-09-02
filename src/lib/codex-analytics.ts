import type { AgentDxThreadSummary } from './agent-dx-analytics';
import {
    buildAgentDxAnalytics,
    captureAgentDxRecord,
    createAgentDxAccumulator,
    finishAgentDxAnalysis,
} from './agent-dx-analytics';
import { getThreadRelationsBatch, listScopedThreads } from './codex-browser-db';
import type { CodexAnalytics, DistributionItem, ModelTokenSummary } from './codex-browser-types';
import {
    captureCodexOptimizationRecord,
    createCodexOptimizationAccumulator,
    finishCodexOptimizationAnalysis,
    type ThreadOptimizationSummary,
} from './codex-optimization-analysis';
import { buildCodexOptimizationAnalytics } from './codex-optimization-findings';
import type { ThreadRelations, ThreadRow } from './codex-thread-types';
import { mapWithConcurrency } from './concurrency';
import { getPortablePathBasename } from './portable-path';
import { asObject, asString, readJsonlObjects } from './shared';
import { hashCacheKeyPartsIterable, withCachedJson } from './ui-cache';

export type CodexAnalyticsInput = {
    dbPath: string;
    project: string | null;
    transcriptConcurrency?: number;
};

export type ThreadAnalyticsSummary = {
    agentDx?: AgentDxThreadSummary;
    hasWebSearch: boolean;
    optimization?: ThreadOptimizationSummary;
    toolNames: string[];
};

export type ComputeCodexAnalyticsOptions = {
    loadThreadAnalytics?: (thread: ThreadRow) => Promise<ThreadAnalyticsSummary>;
    threadRelations?: ReadonlyMap<string, ThreadRelations>;
    transcriptConcurrency?: number;
};

export const DEFAULT_ANALYTICS_TRANSCRIPT_CONCURRENCY = 8;

export const resolveAnalyticsTranscriptConcurrency = (
    configuredValue = process.env.SPIRACHA_ANALYTICS_TRANSCRIPT_CONCURRENCY,
) => {
    const parsed = Number(configuredValue);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return DEFAULT_ANALYTICS_TRANSCRIPT_CONCURRENCY;
    }

    return parsed;
};

const roundToTwoDecimals = (value: number) => {
    return Number(value.toFixed(2));
};

const median = (values: number[]) => {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[midpoint]!;
    }

    return roundToTwoDecimals((sorted[midpoint - 1]! + sorted[midpoint]!) / 2);
};

const incrementCount = (counts: Map<string, number>, key: string) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
};

const toDistribution = (counts: Map<string, number>): DistributionItem[] => {
    return [...counts.entries()]
        .map(([label, count]) => ({ count, label }))
        .sort((left, right) => {
            if (left.count !== right.count) {
                return right.count - left.count;
            }

            return left.label.localeCompare(right.label);
        });
};

const buildModelsByTokens = (threads: ThreadRow[]): ModelTokenSummary[] => {
    const models = new Map<string, { threadCount: number; totalTokens: number }>();

    for (const thread of threads) {
        const model = thread.model ?? 'unknown';
        const current = models.get(model) ?? { threadCount: 0, totalTokens: 0 };
        current.threadCount += 1;
        current.totalTokens += thread.tokens_used;
        models.set(model, current);
    }

    return [...models.entries()]
        .map(([model, value]) => ({ model, ...value }))
        .sort((left, right) => {
            if (left.totalTokens !== right.totalTokens) {
                return right.totalTokens - left.totalTokens;
            }

            return left.model.localeCompare(right.model);
        });
};

const timestampSignature = (thread: ThreadRow) => {
    return String(thread.updated_at_ms ?? thread.updated_at * 1000);
};

const threadMetadataCacheKeyParts = (thread: ThreadRow) => [
    thread.id,
    thread.rollout_path,
    timestampSignature(thread),
    String(thread.created_at_ms ?? thread.created_at * 1000),
    String(thread.tokens_used),
    String(thread.archived),
    String(thread.archived_at ?? ''),
    thread.cwd,
    thread.model ?? '',
    thread.reasoning_effort ?? '',
    thread.source,
    thread.model_provider,
    thread.cli_version,
    thread.title,
    thread.preview,
];

export const buildCodexAnalyticsCacheKey = (
    dbPath: string,
    threads: ThreadRow[],
    project: string | null,
    threadRelations?: ReadonlyMap<string, ThreadRelations>,
) => {
    const parts = (function* () {
        yield 'v6';
        yield dbPath;
        yield project ?? 'all';
        yield String(threads.length);
        for (const thread of threads) {
            yield* threadMetadataCacheKeyParts(thread);
        }
        for (const thread of threads) {
            const relations = threadRelations?.get(thread.id);
            if (!relations) {
                continue;
            }
            yield thread.id;
            yield relations.parentThreadId ?? '';
            for (const edge of relations.childEdges) {
                yield edge.parent_thread_id;
                yield edge.child_thread_id;
                yield edge.status;
            }
        }
    })();

    return `analytics-${hashCacheKeyPartsIterable(parts)}`;
};

const buildThreadAnalyticsCacheKey = (thread: ThreadRow) => {
    return `thread-analytics-${hashCacheKeyPartsIterable(['v3', ...threadMetadataCacheKeyParts(thread)])}`;
};

const parseThreadAnalyticsFile = async (thread: ThreadRow): Promise<ThreadAnalyticsSummary> => {
    const toolNames: string[] = [];
    const optimization = createCodexOptimizationAccumulator();
    const agentDx = createAgentDxAccumulator({
        createdAtMs: thread.created_at_ms ?? thread.created_at * 1000,
        cwd: thread.cwd,
        reportedUsageValue: thread.tokens_used,
        repositoryIdentityBefore: thread.git_sha,
        sourceThreadId: thread.id,
    });
    let hasWebSearch = false;

    for await (const parsed of readJsonlObjects(thread.rollout_path)) {
        captureAgentDxRecord(parsed, agentDx);
        captureCodexOptimizationRecord(parsed, optimization);
        if (parsed.type !== 'response_item') {
            continue;
        }

        const payload = asObject(parsed.payload);
        if (!payload) {
            continue;
        }

        const payloadType = asString(payload.type);
        if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
            toolNames.push(asString(payload.name) ?? 'unknown');
            continue;
        }

        if (payloadType === 'web_search_call' || payloadType === 'web_search_end') {
            hasWebSearch = true;
        }
    }

    return {
        agentDx: finishAgentDxAnalysis(agentDx),
        hasWebSearch,
        optimization: finishCodexOptimizationAnalysis(optimization),
        toolNames,
    };
};

const getCachedThreadAnalytics = async (thread: ThreadRow): Promise<ThreadAnalyticsSummary> => {
    return withCachedJson(buildThreadAnalyticsCacheKey(thread), () => parseThreadAnalyticsFile(thread));
};

export const computeCodexAnalyticsFromThreads = async (
    threads: ThreadRow[],
    options: ComputeCodexAnalyticsOptions = {},
): Promise<CodexAnalytics> => {
    const totalTokens = threads.reduce((sum, thread) => sum + thread.tokens_used, 0);
    const projectNames = new Set(threads.map((thread) => getPortablePathBasename(thread.cwd)).filter(Boolean));
    const reasoningEfforts = new Map<string, number>();
    const sources = new Map<string, number>();
    const toolUsage = new Map<string, number>();
    let threadsWithWebSearch = 0;
    const loadThreadAnalytics = options.loadThreadAnalytics ?? getCachedThreadAnalytics;
    const transcriptConcurrency = options.transcriptConcurrency ?? resolveAnalyticsTranscriptConcurrency();
    const threadAnalytics = await mapWithConcurrency(threads, transcriptConcurrency, (thread) =>
        loadThreadAnalytics(thread),
    );
    const threadIds = new Set(threads.map((thread) => thread.id));
    const agentDx = buildAgentDxAnalytics(
        threads.map((thread, index) => {
            const relation = options.threadRelations?.get(thread.id);
            const summary =
                threadAnalytics[index]!.agentDx ??
                finishAgentDxAnalysis(
                    createAgentDxAccumulator({
                        createdAtMs: thread.created_at_ms ?? thread.created_at * 1000,
                        cwd: thread.cwd,
                        reportedUsageValue: thread.tokens_used,
                        repositoryIdentityBefore: thread.git_sha,
                        sourceThreadId: thread.id,
                    }),
                );
            return {
                agentRole: thread.agent_role,
                childThreadIds: (relation?.childEdges ?? [])
                    .map((edge) => edge.child_thread_id)
                    .filter((childId) => threadIds.has(childId)),
                createdAtMs: thread.created_at_ms ?? thread.created_at * 1000,
                cwd: thread.cwd,
                firstUserMessage: thread.first_user_message,
                gitSha: thread.git_sha,
                parentThreadId: relation?.parentThreadId ?? null,
                source: thread.source,
                summary,
                threadId: thread.id,
                title: thread.title,
                tokensUsed: thread.tokens_used,
            };
        }),
    );

    for (const thread of threads) {
        incrementCount(reasoningEfforts, thread.reasoning_effort?.trim() || 'unspecified');
        incrementCount(sources, thread.source.trim() || 'unknown');
    }

    for (const analytics of threadAnalytics) {
        if (analytics.hasWebSearch) {
            threadsWithWebSearch += 1;
        }

        for (const toolName of analytics.toolNames) {
            incrementCount(toolUsage, toolName);
        }
    }

    return {
        agentDx,
        modelsByTokens: buildModelsByTokens(threads),
        optimization: buildCodexOptimizationAnalytics(
            threadAnalytics.flatMap((analytics) => (analytics.optimization ? [analytics.optimization] : [])),
        ),
        reasoningEfforts: toDistribution(reasoningEfforts),
        sources: toDistribution(sources),
        summary: {
            archivedThreads: threads.filter((thread) => Boolean(thread.archived)).length,
            averageTokensPerThread: threads.length === 0 ? 0 : roundToTwoDecimals(totalTokens / threads.length),
            distinctToolNames: toolUsage.size,
            medianTokensPerThread: median(threads.map((thread) => thread.tokens_used)),
            threadsWithWebSearch,
            totalProjects: projectNames.size,
            totalThreads: threads.length,
            totalTokens,
        },
        toolUsage: toDistribution(toolUsage).map((item) => ({ count: item.count, name: item.label })),
    };
};

export const getCodexAnalytics = async (input: CodexAnalyticsInput): Promise<CodexAnalytics> => {
    const threads = listScopedThreads(input.dbPath, input.project);
    const threadRelations = getThreadRelationsBatch(
        input.dbPath,
        threads.map((thread) => thread.id),
    );
    const key = buildCodexAnalyticsCacheKey(input.dbPath, threads, input.project, threadRelations);

    return withCachedJson(key, async () =>
        computeCodexAnalyticsFromThreads(threads, {
            threadRelations,
            transcriptConcurrency: input.transcriptConcurrency,
        }),
    );
};
