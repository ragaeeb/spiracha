import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedCodexTranscript } from './codex-browser-types';
import { parseCodexTranscriptFile } from './codex-thread-parser';
import { getFileFingerprint, hashCacheKeyParts, withCachedJson } from './ui-cache';

export const LARGE_THREAD_SIZE_BYTES = 100 * 1024 * 1024;
export const LARGE_THREAD_PREVIEW_EVENT_LIMIT = 200;

const isMissingFileError = (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
};

export const getCachedParsedCodexTranscript = async (sessionFile: string): Promise<ParsedCodexTranscript> => {
    const fingerprint = await getFileFingerprint(sessionFile);
    const key = `thread-${hashCacheKeyParts(path.basename(sessionFile), fingerprint)}`;

    return withCachedJson(key, async () => parseCodexTranscriptFile(sessionFile));
};

type CachedThreadTranscriptPreviewOptions = {
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
    const fingerprint = await getFileFingerprint(sessionFile);
    const { fileSizeBytes, shouldDeferTranscriptLoad } = await getThreadRolloutLoadState(sessionFile, threshold);
    const key = `thread-preview-${hashCacheKeyParts(path.basename(sessionFile), fingerprint, String(threshold), String(previewEventLimit))}`;

    return withCachedJson(key, async () => {
        if (!shouldDeferTranscriptLoad) {
            return parseCodexTranscriptFile(sessionFile, {
                sourceFileSizeBytes: fileSizeBytes,
            });
        }

        return parseCodexTranscriptFile(sessionFile, {
            includeRaw: false,
            maxEvents: previewEventLimit,
            maxTurnContexts: 0,
            sourceFileSizeBytes: fileSizeBytes,
        });
    });
};
