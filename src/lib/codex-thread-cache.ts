import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedCodexTranscript } from './codex-browser-types';
import {
    assertCodexTranscriptSegmentComplete,
    type CodexForkedThreadResolver,
    type CodexTranscriptSegment,
    parseCodexTranscriptFile,
    resolveCodexTranscriptSegments,
    validateCodexTranscriptSegmentOrdinal,
} from './codex-thread-parser';
import type { ThreadTranscriptStats, TranscriptEventFilters } from './conversation-data/conversation-events';
import { shouldShowTranscriptEvent } from './conversation-data/conversation-events';
import { splitJsonlLines } from './shared';
import { runWithTranscriptLoadLimit } from './transcript-load-limiter';
import { getFileFingerprint, hashCacheKeyPartsIterable, withCachedJson } from './ui-cache';

// Keep initial thread payloads below sizes that make TanStack Start SSR responses unreliable.
export const LARGE_THREAD_SIZE_BYTES = 8 * 1024 * 1024;
export const LARGE_THREAD_PREVIEW_EVENT_LIMIT = 200;
const CODEX_TRANSCRIPT_CACHE_VERSION = 'v4';
const CODEX_TRANSCRIPT_STATS_CACHE_VERSION = 'v2';
const CODEX_TRANSCRIPT_MODELS_CACHE_VERSION = 'v2';
const FILE_STABILITY_ATTEMPTS = 3;
const CODEX_MODEL_RECORD_PATTERN = /"type"\s*:\s*"(?:turn_context|thread_settings_applied)"/u;
const CODEX_MODEL_NAME_PATTERN = /"model"\s*:\s*"([^"\\]+)"/u;

type CodexTranscriptCacheOptions = {
    resolveForkedThread?: CodexForkedThreadResolver;
};

type CodexTranscriptStatsLoader = (
    sessionFile: string,
    options?: CodexTranscriptCacheOptions,
) => Promise<ThreadTranscriptStats>;

const isMissingFileError = (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
};

const getTranscriptFingerprint = async (sessionFile: string, resolveForkedThread?: CodexForkedThreadResolver) => {
    const segments = await resolveCodexTranscriptSegments(sessionFile, resolveForkedThread);
    return hashCacheKeyPartsIterable(
        await Promise.all(
            segments.map(async (segment) =>
                [
                    path.resolve(segment.sessionFile),
                    String(segment.minOrdinalInclusive),
                    String(segment.maxOrdinalExclusive),
                    await getFileFingerprint(segment.sessionFile),
                ].join(':'),
            ),
        ),
    );
};

const withStableFileCache = async <T>(
    sessionFile: string,
    keyForFingerprint: (fingerprint: string) => string,
    loader: () => Promise<T>,
    getFingerprint: () => Promise<string> = () => getFileFingerprint(sessionFile),
): Promise<T> => {
    for (let attempt = 0; attempt < FILE_STABILITY_ATTEMPTS; attempt += 1) {
        const fingerprint = await getFingerprint();
        const value = await withCachedJson(keyForFingerprint(fingerprint), loader);
        if ((await getFingerprint()) === fingerprint) {
            return value;
        }
    }

    throw new Error(`Codex rollout changed repeatedly while loading: ${sessionFile}`);
};

export const getCachedParsedCodexTranscript = async (
    sessionFile: string,
    options: CodexTranscriptCacheOptions = {},
): Promise<ParsedCodexTranscript> => {
    const getFingerprint = () => getTranscriptFingerprint(sessionFile, options.resolveForkedThread);
    return withStableFileCache(
        sessionFile,
        (fingerprint) =>
            `thread-${hashCacheKeyPartsIterable([CODEX_TRANSCRIPT_CACHE_VERSION, path.basename(sessionFile), fingerprint])}`,
        async () =>
            runWithTranscriptLoadLimit(() => parseCodexTranscriptFile(sessionFile, options), {
                integration: 'codex',
                operation: 'full',
                path: sessionFile,
            }),
        getFingerprint,
    );
};

const loadCodexTranscriptStats: CodexTranscriptStatsLoader = async (sessionFile, options = {}) => {
    const transcript = await parseCodexTranscriptFile(sessionFile, {
        includeRaw: false,
        maxTurnContexts: 0,
        resolveForkedThread: options.resolveForkedThread,
    });

    return transcript.stats;
};

export const getCachedCodexTranscriptStats = async (
    sessionFile: string,
    loadStats: CodexTranscriptStatsLoader = loadCodexTranscriptStats,
    options: CodexTranscriptCacheOptions = {},
): Promise<ThreadTranscriptStats> => {
    const getFingerprint = () => getTranscriptFingerprint(sessionFile, options.resolveForkedThread);
    return withStableFileCache(
        sessionFile,
        (fingerprint) =>
            `thread-list-stats-${hashCacheKeyPartsIterable([
                CODEX_TRANSCRIPT_STATS_CACHE_VERSION,
                path.basename(sessionFile),
                fingerprint,
            ])}`,
        () =>
            runWithTranscriptLoadLimit(() => loadStats(sessionFile, options), {
                integration: 'codex',
                operation: 'list-stats',
                path: sessionFile,
            }),
        getFingerprint,
    );
};

export const getCachedCodexTranscriptModelNames = async (
    sessionFile: string,
    options: CodexTranscriptCacheOptions = {},
): Promise<string[]> => {
    const getFingerprint = () => getTranscriptFingerprint(sessionFile, options.resolveForkedThread);
    return withStableFileCache(
        sessionFile,
        (fingerprint) =>
            `thread-models-${hashCacheKeyPartsIterable([
                CODEX_TRANSCRIPT_MODELS_CACHE_VERSION,
                path.basename(sessionFile),
                fingerprint,
            ])}`,
        () =>
            runWithTranscriptLoadLimit(
                () => collectCodexTranscriptModelNames(sessionFile, options.resolveForkedThread),
                {
                    integration: 'codex',
                    operation: 'model-history',
                    path: sessionFile,
                },
            ),
        getFingerprint,
    );
};

const collectCodexTranscriptModelNames = async (
    sessionFile: string,
    resolveForkedThread?: CodexForkedThreadResolver,
): Promise<string[]> => {
    const modelNames: string[] = [];
    const segments = await resolveCodexTranscriptSegments(sessionFile, resolveForkedThread);
    for (const segment of segments) {
        await scanCodexModelSegment(segment, modelNames);
    }
    return modelNames;
};

const readTopLevelOrdinal = (line: string): number | null => {
    try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        const ordinal = (parsed as Record<string, unknown>).ordinal;
        return typeof ordinal === 'number' ? ordinal : null;
    } catch {
        return null;
    }
};

const scanCodexTranscriptSegment = async (segment: CodexTranscriptSegment, visitLine: (line: string) => void) => {
    let expectedOrdinal: number | null = null;
    let lastOrdinal: number | null = null;
    const lines = splitJsonlLines(createReadStream(segment.sessionFile, { encoding: 'utf8' }));
    try {
        for await (const line of lines) {
            if (!line.trim()) {
                visitLine(line);
                continue;
            }
            const ordinal = segment.maxOrdinalExclusive === null ? null : readTopLevelOrdinal(line);
            const progress = validateCodexTranscriptSegmentOrdinal(ordinal, segment, expectedOrdinal, lastOrdinal);
            expectedOrdinal = progress.expectedOrdinal;
            lastOrdinal = progress.lastOrdinal;
            if (progress.done) {
                break;
            }
            visitLine(line);
        }
    } finally {
        await lines.return(undefined);
    }

    assertCodexTranscriptSegmentComplete(segment, lastOrdinal);
};

const scanCodexModelSegment = async (segment: CodexTranscriptSegment, modelNames: string[]) => {
    await scanCodexTranscriptSegment(segment, (line) => {
        if (!CODEX_MODEL_RECORD_PATTERN.test(line)) {
            return;
        }
        const modelName = CODEX_MODEL_NAME_PATTERN.exec(line)?.[1];
        if (modelName && !modelNames.includes(modelName)) {
            modelNames.push(modelName);
        }
    });
};

const getCodexTranscriptSegmentSize = async (segment: CodexTranscriptSegment) => {
    if (segment.maxOrdinalExclusive === null) {
        return (await stat(segment.sessionFile)).size;
    }

    let size = 0;
    await scanCodexTranscriptSegment(segment, (line) => {
        size += Buffer.byteLength(line) + 1;
    });
    return size;
};

type CachedThreadTranscriptPreviewOptions = CodexTranscriptCacheOptions & {
    filters?: TranscriptEventFilters;
    largeTranscriptThresholdBytes?: number;
    previewEventLimit?: number;
};

export const getThreadRolloutLoadState = async (
    sessionFile: string,
    largeTranscriptThresholdBytes = LARGE_THREAD_SIZE_BYTES,
    options: CodexTranscriptCacheOptions = {},
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

    let fileSizeBytes = metadata.size;
    if (options.resolveForkedThread) {
        const segments = await resolveCodexTranscriptSegments(sessionFile, options.resolveForkedThread);
        fileSizeBytes = 0;
        for (const segment of segments) {
            fileSizeBytes += await getCodexTranscriptSegmentSize(segment);
        }
    }

    return {
        fileSizeBytes,
        shouldDeferTranscriptLoad: fileSizeBytes > largeTranscriptThresholdBytes,
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
    const getFingerprint = () => getTranscriptFingerprint(sessionFile, options.resolveForkedThread);
    return withStableFileCache(
        sessionFile,
        (fingerprint) =>
            `thread-preview-${hashCacheKeyPartsIterable([
                CODEX_TRANSCRIPT_CACHE_VERSION,
                path.basename(sessionFile),
                fingerprint,
                String(threshold),
                String(previewEventLimit),
                filterKey,
            ])}`,
        async () => {
            const { fileSizeBytes, shouldDeferTranscriptLoad } = await getThreadRolloutLoadState(
                sessionFile,
                threshold,
                options,
            );
            if (!shouldDeferTranscriptLoad) {
                return runWithTranscriptLoadLimit(
                    () =>
                        parseCodexTranscriptFile(sessionFile, {
                            resolveForkedThread: options.resolveForkedThread,
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
                        eventFilter: filters ? (event) => shouldShowTranscriptEvent(event, filters) : undefined,
                        includeRaw: false,
                        maxTurnContexts: 0,
                        resolveForkedThread: options.resolveForkedThread,
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
        getFingerprint,
    );
};
