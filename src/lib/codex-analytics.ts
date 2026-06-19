import { listScopedThreads } from './codex-browser-db';
import type { CodexAnalytics, DistributionItem, ModelTokenSummary } from './codex-browser-types';
import type { ThreadRow } from './codex-thread-types';
import { mapWithConcurrency } from './concurrency';
import { asObject, asString, getPortablePathBasename, readJsonlObjects } from './shared';
import { hashCacheKeyParts, hashCacheKeyPartsIterable, withCachedJson } from './ui-cache';

export type CodexAnalyticsInput = {
    dbPath: string;
    project: string | null;
    transcriptConcurrency?: number;
};

export type ThreadAnalyticsSummary = {
    hasWebSearch: boolean;
    toolNames: string[];
};

export type ComputeCodexAnalyticsOptions = {
    loadThreadAnalytics?: (thread: ThreadRow) => Promise<ThreadAnalyticsSummary>;
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
    thread.model_provider,
    thread.cli_version,
    thread.title,
    thread.preview,
];

export const buildCodexAnalyticsCacheKey = (dbPath: string, threads: ThreadRow[], project: string | null) => {
    const parts = (function* () {
        yield 'v2';
        yield dbPath;
        yield project ?? 'all';
        yield String(threads.length);
        for (const thread of threads) {
            yield* threadMetadataCacheKeyParts(thread);
        }
    })();

    return `analytics-${hashCacheKeyPartsIterable(parts)}`;
};

const buildThreadAnalyticsCacheKey = (thread: ThreadRow) => {
    return `thread-analytics-${hashCacheKeyParts('v1', ...threadMetadataCacheKeyParts(thread))}`;
};

const parseThreadAnalyticsFile = async (sessionFile: string): Promise<ThreadAnalyticsSummary> => {
    const toolNames: string[] = [];
    let hasWebSearch = false;

    for await (const parsed of readJsonlObjects(sessionFile)) {
        if (parsed.type !== 'response_item') {
            continue;
        }

        const payload = asObject(parsed.payload);
        if (!payload) {
            continue;
        }

        const payloadType = asString(payload.type);
        if (payloadType === 'function_call') {
            toolNames.push(asString(payload.name) ?? 'unknown');
            continue;
        }

        if (payloadType === 'web_search_call' || payloadType === 'web_search_end') {
            hasWebSearch = true;
        }
    }

    return {
        hasWebSearch,
        toolNames,
    };
};

const getCachedThreadAnalytics = async (thread: ThreadRow): Promise<ThreadAnalyticsSummary> => {
    return withCachedJson(buildThreadAnalyticsCacheKey(thread), () => parseThreadAnalyticsFile(thread.rollout_path));
};

export const computeCodexAnalyticsFromThreads = async (
    threads: ThreadRow[],
    options: ComputeCodexAnalyticsOptions = {},
): Promise<CodexAnalytics> => {
    const totalTokens = threads.reduce((sum, thread) => sum + thread.tokens_used, 0);
    const projectNames = new Set(threads.map((thread) => getPortablePathBasename(thread.cwd)).filter(Boolean));
    const toolUsage = new Map<string, number>();
    let threadsWithWebSearch = 0;
    const loadThreadAnalytics = options.loadThreadAnalytics ?? getCachedThreadAnalytics;
    const transcriptConcurrency = options.transcriptConcurrency ?? resolveAnalyticsTranscriptConcurrency();
    const threadAnalytics = await mapWithConcurrency(threads, transcriptConcurrency, (thread) =>
        loadThreadAnalytics(thread),
    );

    for (const analytics of threadAnalytics) {
        if (analytics.hasWebSearch) {
            threadsWithWebSearch += 1;
        }

        for (const toolName of analytics.toolNames) {
            incrementCount(toolUsage, toolName);
        }
    }

    return {
        modelsByTokens: buildModelsByTokens(threads),
        summary: {
            archivedThreads: threads.filter((thread) => Boolean(thread.archived)).length,
            averageTokensPerThread: threads.length === 0 ? 0 : roundToTwoDecimals(totalTokens / threads.length),
            distinctToolNames: toolUsage.size,
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
    const key = buildCodexAnalyticsCacheKey(input.dbPath, threads, input.project);

    return withCachedJson(key, async () =>
        computeCodexAnalyticsFromThreads(threads, {
            transcriptConcurrency: input.transcriptConcurrency,
        }),
    );
};
