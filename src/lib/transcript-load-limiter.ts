import { createConcurrencyLimiter } from './concurrency';

const DEFAULT_TRANSCRIPT_LOAD_CONCURRENCY = 3;
const MAX_TRANSCRIPT_LOAD_CONCURRENCY = 16;
const DEFAULT_TOTAL_TRANSCRIPT_LOAD_CONCURRENCY = 16;
const MAX_TOTAL_TRANSCRIPT_LOAD_CONCURRENCY = 32;
export type TranscriptLoadIntegration =
    | 'antigravity'
    | 'claude-code'
    | 'codex'
    | 'cursor'
    | 'grok'
    | 'kiro'
    | 'opencode'
    | 'qoder';

type TranscriptLoadContext = {
    id?: string;
    integration: TranscriptLoadIntegration;
    operation: string;
    path?: string;
};

let nextTranscriptLoadId = 1;
let activeTranscriptLoads = 0;
let queuedTranscriptLoads = 0;
const activeLoadsByIntegration = new Map<TranscriptLoadIntegration, number>();
const queuedLoadsByIntegration = new Map<TranscriptLoadIntegration, number>();

export const resolveTranscriptLoadConcurrency = (value = process.env.SPIRACHA_TRANSCRIPT_LOAD_CONCURRENCY): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, MAX_TRANSCRIPT_LOAD_CONCURRENCY)
        : DEFAULT_TRANSCRIPT_LOAD_CONCURRENCY;
};

export const resolveTotalTranscriptLoadConcurrency = (integrationConcurrency = resolveTranscriptLoadConcurrency()) =>
    Math.min(
        MAX_TOTAL_TRANSCRIPT_LOAD_CONCURRENCY,
        Math.max(DEFAULT_TOTAL_TRANSCRIPT_LOAD_CONCURRENCY, integrationConcurrency * 2),
    );

const transcriptLoadLimiters = new Map<TranscriptLoadIntegration, ReturnType<typeof createConcurrencyLimiter>>();
const totalTranscriptLoadLimiter = createConcurrencyLimiter(resolveTotalTranscriptLoadConcurrency());

const getTranscriptLoadLimiter = (integration: TranscriptLoadIntegration) => {
    const existing = transcriptLoadLimiters.get(integration);
    if (existing) {
        return existing;
    }

    const limiter = createConcurrencyLimiter(resolveTranscriptLoadConcurrency());
    transcriptLoadLimiters.set(integration, limiter);
    return limiter;
};

const updateIntegrationCount = (
    counts: Map<TranscriptLoadIntegration, number>,
    integration: TranscriptLoadIntegration,
    change: number,
) => {
    const next = (counts.get(integration) ?? 0) + change;
    if (next === 0) {
        counts.delete(integration);
    } else {
        counts.set(integration, next);
    }
    return next;
};

const shouldLogTranscriptLoads = () => process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS === '1';

const logTranscriptLoad = (event: string, details: Record<string, unknown>) => {
    if (shouldLogTranscriptLoads()) {
        console.info(`[spiracha:transcript-load] ${event}`, details);
    }
};

export const runWithTranscriptLoadLimit = async <T>(
    loader: () => Promise<T>,
    context: TranscriptLoadContext,
): Promise<T> => {
    const loadId = nextTranscriptLoadId;
    nextTranscriptLoadId += 1;
    queuedTranscriptLoads += 1;
    updateIntegrationCount(queuedLoadsByIntegration, context.integration, 1);
    const queuedAt = Date.now();

    return getTranscriptLoadLimiter(context.integration)(() =>
        totalTranscriptLoadLimiter(async () => {
            queuedTranscriptLoads -= 1;
            const queuedForIntegration = updateIntegrationCount(queuedLoadsByIntegration, context.integration, -1);
            activeTranscriptLoads += 1;
            const activeForIntegration = updateIntegrationCount(activeLoadsByIntegration, context.integration, 1);
            const startedAt = Date.now();
            logTranscriptLoad('start', {
                activeForIntegration,
                activeTotal: activeTranscriptLoads,
                id: context.id,
                integration: context.integration,
                loadId,
                operation: context.operation,
                path: context.path,
                queuedForIntegration,
                queuedTotal: queuedTranscriptLoads,
                waitMs: startedAt - queuedAt,
            });

            try {
                return await loader();
            } catch (error) {
                logTranscriptLoad('error', {
                    activeForIntegration: activeLoadsByIntegration.get(context.integration) ?? 0,
                    activeTotal: activeTranscriptLoads,
                    durationMs: Date.now() - startedAt,
                    error: error instanceof Error ? error.message : String(error),
                    id: context.id,
                    integration: context.integration,
                    loadId,
                    operation: context.operation,
                    path: context.path,
                    queuedForIntegration,
                    queuedTotal: queuedTranscriptLoads,
                });
                throw error;
            } finally {
                activeTranscriptLoads -= 1;
                const remainingActiveForIntegration = updateIntegrationCount(
                    activeLoadsByIntegration,
                    context.integration,
                    -1,
                );
                logTranscriptLoad('finish', {
                    activeForIntegration: remainingActiveForIntegration,
                    activeTotal: activeTranscriptLoads,
                    durationMs: Date.now() - startedAt,
                    id: context.id,
                    integration: context.integration,
                    loadId,
                    operation: context.operation,
                    path: context.path,
                    queuedForIntegration: queuedLoadsByIntegration.get(context.integration) ?? 0,
                    queuedTotal: queuedTranscriptLoads,
                });
            }
        }),
    );
};
