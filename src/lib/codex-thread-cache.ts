import { stat } from 'node:fs/promises';
import path from 'node:path';
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
const FILE_STABILITY_ATTEMPTS = 3;

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
                path: sessionFile,
                source: 'codex-full',
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
                path: sessionFile,
                source: 'codex-list-stats',
            }),
    );
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
                        path: sessionFile,
                        source: 'codex-preview-full',
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
                    path: sessionFile,
                    source: 'codex-preview',
                },
            );
        },
    );
};
