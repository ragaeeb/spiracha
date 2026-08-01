import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { ParsedCodexTranscript, ThreadTranscriptStats } from './codex-browser-types';
import { parseCodexTranscriptFile } from './codex-thread-parser';
import type { CodexTranscriptEventFilters } from './codex-transcript-filter';
import { shouldShowCodexTranscriptEvent } from './codex-transcript-filter';
import { runWithTranscriptLoadLimit } from './transcript-load-limiter';
import { getFileFingerprint, hashCacheKeyPartsIterable, withCachedJson } from './ui-cache';

// Keep initial thread payloads below sizes that make TanStack Start SSR responses unreliable.
export const LARGE_THREAD_SIZE_BYTES = 8 * 1024 * 1024;
export const LARGE_THREAD_PREVIEW_EVENT_LIMIT = 200;
const CODEX_TRANSCRIPT_CACHE_VERSION = 'v3';
const CODEX_TRANSCRIPT_STATS_CACHE_VERSION = 'v1';
const CODEX_TRANSCRIPT_MODELS_CACHE_VERSION = 'v1';
const FILE_STABILITY_ATTEMPTS = 3;
const CODEX_MODEL_RECORD_TYPES = ['"type":"turn_context"', '"type":"thread_settings_applied"'] as const;
const CODEX_MODEL_NAME_PATTERN = /"model"\s*:\s*"([^"\\]+)"/u;

type CodexTranscriptStatsLoader = (sessionFile: string) => Promise<ThreadTranscriptStats>;

const isMissingFileError = (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
};

const withStableFileCache = async <T>(
    sessionFile: string,
    keyForFingerprint: (fingerprint: string) => string,
    loader: () => Promise<T>,
): Promise<T> => {
    for (let attempt = 0; attempt < FILE_STABILITY_ATTEMPTS; attempt += 1) {
        const fingerprint = await getFileFingerprint(sessionFile);
        const value = await withCachedJson(keyForFingerprint(fingerprint), loader);
        if ((await getFileFingerprint(sessionFile)) === fingerprint) {
            return value;
        }
    }

    throw new Error(`Codex rollout changed repeatedly while loading: ${sessionFile}`);
};

export const getCachedParsedCodexTranscript = async (sessionFile: string): Promise<ParsedCodexTranscript> => {
    return withStableFileCache(
        sessionFile,
        (fingerprint) =>
            `thread-${hashCacheKeyPartsIterable([CODEX_TRANSCRIPT_CACHE_VERSION, path.basename(sessionFile), fingerprint])}`,
        async () =>
            runWithTranscriptLoadLimit(() => parseCodexTranscriptFile(sessionFile), {
                integration: 'codex',
                operation: 'full',
                path: sessionFile,
            }),
    );
};

const loadCodexTranscriptStats: CodexTranscriptStatsLoader = async (sessionFile) => {
    const transcript = await parseCodexTranscriptFile(sessionFile, {
        includeRaw: false,
        maxTurnContexts: 0,
    });

    return transcript.stats;
};

export const getCachedCodexTranscriptStats = async (
    sessionFile: string,
    loadStats: CodexTranscriptStatsLoader = loadCodexTranscriptStats,
): Promise<ThreadTranscriptStats> => {
    return withStableFileCache(
        sessionFile,
        (fingerprint) =>
            `thread-list-stats-${hashCacheKeyPartsIterable([
                CODEX_TRANSCRIPT_STATS_CACHE_VERSION,
                path.basename(sessionFile),
                fingerprint,
            ])}`,
        () =>
            runWithTranscriptLoadLimit(() => loadStats(sessionFile), {
                integration: 'codex',
                operation: 'list-stats',
                path: sessionFile,
            }),
    );
};

export const getCachedCodexTranscriptModelNames = async (sessionFile: string): Promise<string[]> => {
    return withStableFileCache(
        sessionFile,
        (fingerprint) =>
            `thread-models-${hashCacheKeyPartsIterable([
                CODEX_TRANSCRIPT_MODELS_CACHE_VERSION,
                path.basename(sessionFile),
                fingerprint,
            ])}`,
        () =>
            runWithTranscriptLoadLimit(() => collectCodexTranscriptModelNames(sessionFile), {
                integration: 'codex',
                operation: 'model-history',
                path: sessionFile,
            }),
    );
};

const collectCodexTranscriptModelNames = async (sessionFile: string): Promise<string[]> => {
    const modelNames: string[] = [];
    const lines = createInterface({
        crlfDelay: Number.POSITIVE_INFINITY,
        input: createReadStream(sessionFile, { encoding: 'utf8' }),
    });

    for await (const line of lines) {
        if (!CODEX_MODEL_RECORD_TYPES.some((recordType) => line.includes(recordType))) {
            continue;
        }

        const modelName = CODEX_MODEL_NAME_PATTERN.exec(line)?.[1];
        if (modelName && !modelNames.includes(modelName)) {
            modelNames.push(modelName);
        }
    }

    return modelNames;
};

type CachedThreadTranscriptPreviewOptions = {
    filters?: CodexTranscriptEventFilters;
    largeTranscriptThresholdBytes?: number;
    previewEventLimit?: number;
};

export const getThreadRolloutLoadState = async (
    sessionFile: string,
    largeTranscriptThresholdBytes = LARGE_THREAD_SIZE_BYTES,
) => {
    let metadata: Awaited<ReturnType<typeof stat>>;
    try {
        metadata = await stat(sessionFile);
    } catch (error) {
        if (isMissingFileError(error)) {
            return {
                fileSizeBytes: null,
                shouldDeferTranscriptLoad: false,
            };
        }

        throw error;
    }

    return {
        fileSizeBytes: metadata.size,
        shouldDeferTranscriptLoad: metadata.size > largeTranscriptThresholdBytes,
    };
};

export const getCachedThreadTranscriptPreview = async (
    sessionFile: string,
    options: CachedThreadTranscriptPreviewOptions = {},
): Promise<ParsedCodexTranscript> => {
    const threshold = options.largeTranscriptThresholdBytes ?? LARGE_THREAD_SIZE_BYTES;
    const previewEventLimit = options.previewEventLimit ?? LARGE_THREAD_PREVIEW_EVENT_LIMIT;
    const filters = options.filters;
    const filterKey = filters ? JSON.stringify(filters) : 'all';
    return withStableFileCache(
        sessionFile,
        (fingerprint) =>
            `thread-preview-${hashCacheKeyPartsIterable([CODEX_TRANSCRIPT_CACHE_VERSION, path.basename(sessionFile), fingerprint, String(threshold), String(previewEventLimit), filterKey])}`,
        async () => {
            const { fileSizeBytes, shouldDeferTranscriptLoad } = await getThreadRolloutLoadState(
                sessionFile,
                threshold,
            );
            if (!shouldDeferTranscriptLoad) {
                return runWithTranscriptLoadLimit(
                    () =>
                        parseCodexTranscriptFile(sessionFile, {
                            sourceFileSizeBytes: fileSizeBytes,
                        }),
                    {
                        integration: 'codex',
                        operation: 'preview-full',
                        path: sessionFile,
                    },
                );
            }

            return runWithTranscriptLoadLimit(
                () =>
                    parseCodexTranscriptFile(sessionFile, {
                        eventFilter: filters ? (event) => shouldShowCodexTranscriptEvent(event, filters) : undefined,
                        includeRaw: false,
                        maxTurnContexts: 0,
                        sourceFileSizeBytes: fileSizeBytes,
                        tailEventLimit: previewEventLimit,
                    }),
                {
                    integration: 'codex',
                    operation: 'preview',
                    path: sessionFile,
                },
            );
        },
    );
};
