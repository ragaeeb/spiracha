import { listScopedThreads } from './codex-browser-db';
import type { CodexAnalytics, DistributionItem, ModelTokenSummary } from './codex-browser-types';
import type { ThreadRow } from './codex-exporter-types';
import { getCachedParsedCodexTranscript } from './codex-thread-cache';
import { getPortablePathBasename } from './shared';
import { getFileFingerprint, hashCacheKeyParts, withCachedJson } from './ui-cache';

export type CodexAnalyticsInput = {
    dbPath: string;
    project: string | null;
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

const buildAnalyticsCacheKey = async (dbPath: string, threads: ThreadRow[], project: string | null) => {
    const dbFingerprint = await getFileFingerprint(dbPath);
    const rolloutFingerprints = await Promise.all(threads.map((thread) => getFileFingerprint(thread.rollout_path)));
    return `analytics-${hashCacheKeyParts(dbFingerprint, project ?? 'all', ...rolloutFingerprints)}`;
};

const computeCodexAnalytics = async (threads: ThreadRow[]): Promise<CodexAnalytics> => {
    const totalTokens = threads.reduce((sum, thread) => sum + thread.tokens_used, 0);
    const projectNames = new Set(threads.map((thread) => getPortablePathBasename(thread.cwd)).filter(Boolean));
    const toolUsage = new Map<string, number>();
    const transcripts = await Promise.all(threads.map((thread) => getCachedParsedCodexTranscript(thread.rollout_path)));
    let threadsWithWebSearch = 0;

    for (const transcript of transcripts) {
        if (transcript.stats.webSearchEventCount > 0) {
            threadsWithWebSearch += 1;
        }

        for (const event of transcript.events) {
            if (event.kind === 'tool_call') {
                incrementCount(toolUsage, event.name);
            }
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
    const key = await buildAnalyticsCacheKey(input.dbPath, threads, input.project);

    return withCachedJson(key, async () => computeCodexAnalytics(threads));
};
