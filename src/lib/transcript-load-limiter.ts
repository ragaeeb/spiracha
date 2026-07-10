import { createConcurrencyLimiter } from './concurrency';

const DEFAULT_TRANSCRIPT_LOAD_CONCURRENCY = 3;
type TranscriptLoadLogContext = {
    id?: string;
    path?: string;
    source?: string;
};

let nextTranscriptLoadId = 1;
let activeTranscriptLoads = 0;
let queuedTranscriptLoads = 0;

export const resolveTranscriptLoadConcurrency = (value = process.env.SPIRACHA_TRANSCRIPT_LOAD_CONCURRENCY): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TRANSCRIPT_LOAD_CONCURRENCY;
};

const transcriptLoadLimiter = createConcurrencyLimiter(resolveTranscriptLoadConcurrency());

const shouldLogTranscriptLoads = () => process.env.SPIRACHA_TRANSCRIPT_LOAD_LOGS !== '0';

const logTranscriptLoad = (event: string, details: Record<string, unknown>) => {
    if (shouldLogTranscriptLoads()) {
        console.info(`[spiracha:transcript-load] ${event}`, details);
    }
};

export const runWithTranscriptLoadLimit = async <T>(
    loader: () => Promise<T>,
    context: TranscriptLoadLogContext = {},
): Promise<T> => {
    const loadId = nextTranscriptLoadId;
    nextTranscriptLoadId += 1;
    queuedTranscriptLoads += 1;
    const queuedAt = Date.now();

    return transcriptLoadLimiter(async () => {
        queuedTranscriptLoads -= 1;
        activeTranscriptLoads += 1;
        const startedAt = Date.now();
        logTranscriptLoad('start', {
            active: activeTranscriptLoads,
            id: context.id,
            loadId,
            path: context.path,
            queued: queuedTranscriptLoads,
            source: context.source,
            waitMs: startedAt - queuedAt,
        });

        try {
            return await loader();
        } catch (error) {
            logTranscriptLoad('error', {
                active: activeTranscriptLoads,
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error),
                id: context.id,
                loadId,
                path: context.path,
                queued: queuedTranscriptLoads,
                source: context.source,
            });
            throw error;
        } finally {
            activeTranscriptLoads -= 1;
            logTranscriptLoad('finish', {
                active: activeTranscriptLoads,
                durationMs: Date.now() - startedAt,
                id: context.id,
                loadId,
                path: context.path,
                queued: queuedTranscriptLoads,
                source: context.source,
            });
        }
    });
};
