import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedCodexTranscript } from './codex-browser-types';
import { parseCodexTranscriptFile } from './codex-thread-parser';
import type { CodexTranscriptEventFilters } from './codex-transcript-filter';
import { shouldShowCodexTranscriptEvent } from './codex-transcript-filter';
import { runWithTranscriptLoadLimit } from './transcript-load-limiter';
import { getFileFingerprint, hashCacheKeyParts, withCachedJson } from './ui-cache';

// Keep initial thread payloads below sizes that make TanStack Start SSR responses unreliable.
export const LARGE_THREAD_SIZE_BYTES = 8 * 1024 * 1024;
export const LARGE_THREAD_PREVIEW_EVENT_LIMIT = 200;
const CODEX_TRANSCRIPT_CACHE_VERSION = 'v2';

const isMissingFileError = (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
};

export const getCachedParsedCodexTranscript = async (sessionFile: string): Promise<ParsedCodexTranscript> => {
    const fingerprint = await getFileFingerprint(sessionFile);
    const key = `thread-${hashCacheKeyParts(CODEX_TRANSCRIPT_CACHE_VERSION, path.basename(sessionFile), fingerprint)}`;

    return withCachedJson(key, async () =>
        runWithTranscriptLoadLimit(() => parseCodexTranscriptFile(sessionFile), {
            path: sessionFile,
            source: 'codex-full',
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
    const fingerprint = await getFileFingerprint(sessionFile);
    const { fileSizeBytes, shouldDeferTranscriptLoad } = await getThreadRolloutLoadState(sessionFile, threshold);
    const filterKey = filters ? JSON.stringify(filters) : 'all';
    const key = `thread-preview-${hashCacheKeyParts(CODEX_TRANSCRIPT_CACHE_VERSION, path.basename(sessionFile), fingerprint, String(threshold), String(previewEventLimit), filterKey)}`;

    return withCachedJson(key, async () => {
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
    });
};
