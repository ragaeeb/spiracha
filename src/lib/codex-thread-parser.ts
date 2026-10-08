import { createReadStream } from 'node:fs';
import path from 'node:path';

import type { CodexMissingForkParent, ParsedCodexTranscript } from './codex-browser-types';
import {
    consumeTranscriptRecord,
    createEmptySessionMeta,
    createTranscriptState,
    finalizeTranscript,
    type ParseCodexTranscriptOptions,
} from './codex-transcript-records';
import { readJsonlObjects, splitJsonlLines } from './shared';

export type CodexForkedThreadResolver = (threadId: string) => Promise<string>;

export class CodexTranscriptHistoryError extends Error {
    readonly code = 'CODEX_TRANSCRIPT_HISTORY_INVALID';

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'CodexTranscriptHistoryError';
    }
}

export type CodexTranscriptSegment = {
    minOrdinalInclusive: number;
    maxOrdinalExclusive: number | null;
    sessionFile: string;
};

const readForkMetadata = async (sessionFile: string) => {
    const lines = splitJsonlLines(createReadStream(sessionFile, { encoding: 'utf8' }));
    for await (const line of lines) {
        if (!/"type"\s*:\s*"session_meta"/u.test(line)) {
            continue;
        }
        const parentPropertyPresent = /"forked_from_id"\s*:/u.test(line);
        const parentMatch = /"forked_from_id"\s*:\s*(?:"([^"\\]*)"|null)/u.exec(line);
        const cutoffPropertyPresent = /"forked_from_ordinal_exclusive"\s*:/u.test(line);
        const cutoffMatch =
            /"forked_from_ordinal_exclusive"\s*:\s*(null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/u.exec(
                line,
            );
        return {
            forkedFromId: parentMatch?.[1] ?? null,
            forkedFromOrdinalExclusive:
                cutoffMatch?.[1] === undefined || cutoffMatch[1] === 'null' ? null : Number(cutoffMatch[1]),
            hasForkedFromOrdinalExclusive: cutoffPropertyPresent,
            hasMalformedForkedFromId: parentPropertyPresent && (!parentMatch || parentMatch[1] === ''),
            hasMalformedForkedFromOrdinalExclusive: cutoffPropertyPresent && !cutoffMatch,
        };
    }

    return {
        forkedFromId: null,
        forkedFromOrdinalExclusive: null,
        hasForkedFromOrdinalExclusive: false,
        hasMalformedForkedFromId: false,
        hasMalformedForkedFromOrdinalExclusive: false,
    };
};

const readSessionMeta = async (sessionFile: string) => {
    const sessionMeta = createEmptySessionMeta();
    for await (const parsed of readJsonlObjects(sessionFile)) {
        if (parsed.type !== 'session_meta') {
            continue;
        }

        consumeTranscriptRecord(parsed, createTranscriptState({}), sessionMeta);
        break;
    }
    return sessionMeta;
};

const readForkBoundary = (
    sessionFile: string,
    metadata: Awaited<ReturnType<typeof readForkMetadata>>,
): { forkedFromId: string; ordinalExclusive: number } | null => {
    const parentValue = metadata.forkedFromId;
    const parentThreadId = typeof parentValue === 'string' && parentValue ? parentValue : null;
    if (
        metadata.hasMalformedForkedFromId ||
        metadata.hasMalformedForkedFromOrdinalExclusive ||
        (parentValue !== null && parentThreadId === null)
    ) {
        throw new CodexTranscriptHistoryError(`Codex transcript ${sessionFile} has invalid fork history metadata`);
    }
    if (
        !metadata.hasForkedFromOrdinalExclusive ||
        (parentThreadId === null && metadata.forkedFromOrdinalExclusive === null)
    ) {
        return null;
    }

    const cutoff = metadata.forkedFromOrdinalExclusive;
    if (parentThreadId === null || typeof cutoff !== 'number' || !Number.isInteger(cutoff) || cutoff < 0) {
        throw new CodexTranscriptHistoryError(`Codex transcript ${sessionFile} has invalid fork history metadata`);
    }
    return { forkedFromId: parentThreadId, ordinalExclusive: cutoff };
};

type SegmentOrdinalProgress = {
    done: boolean;
    expectedOrdinal: number | null;
    lastOrdinal: number | null;
};

export const validateCodexTranscriptSegmentOrdinal = (
    ordinal: number | null,
    segment: CodexTranscriptSegment,
    expectedOrdinal: number | null,
    lastOrdinal: number | null,
): SegmentOrdinalProgress => {
    if (segment.maxOrdinalExclusive === null) {
        return { done: false, expectedOrdinal, lastOrdinal };
    }

    if (ordinal === null || !Number.isInteger(ordinal)) {
        throw new CodexTranscriptHistoryError(
            `Codex transcript ${segment.sessionFile} is missing an ordinal before fork boundary ${segment.maxOrdinalExclusive}`,
        );
    }
    if (ordinal >= segment.maxOrdinalExclusive) {
        return { done: true, expectedOrdinal, lastOrdinal };
    }
    if (
        (expectedOrdinal === null && ordinal !== segment.minOrdinalInclusive) ||
        (expectedOrdinal !== null && ordinal !== expectedOrdinal)
    ) {
        throw new CodexTranscriptHistoryError(
            `Codex transcript ${segment.sessionFile} has a gap before fork boundary ${segment.maxOrdinalExclusive}`,
        );
    }
    return {
        done: false,
        expectedOrdinal: ordinal + 1,
        lastOrdinal: ordinal,
    };
};

export const assertCodexTranscriptSegmentComplete = (segment: CodexTranscriptSegment, lastOrdinal: number | null) => {
    if (
        segment.maxOrdinalExclusive !== null &&
        segment.maxOrdinalExclusive > segment.minOrdinalInclusive &&
        lastOrdinal !== segment.maxOrdinalExclusive - 1
    ) {
        throw new CodexTranscriptHistoryError(
            `Codex transcript ${segment.sessionFile} ends before fork boundary ${segment.maxOrdinalExclusive}`,
        );
    }
};

const consumeTranscriptSegment = async (
    segment: CodexTranscriptSegment,
    state: ReturnType<typeof createTranscriptState>,
    sessionMeta: ReturnType<typeof createEmptySessionMeta>,
) => {
    let expectedOrdinal: number | null = null;
    let lastOrdinal: number | null = null;
    for await (const parsed of readJsonlObjects(segment.sessionFile)) {
        const ordinal = typeof parsed.ordinal === 'number' ? parsed.ordinal : null;
        const progress = validateCodexTranscriptSegmentOrdinal(ordinal, segment, expectedOrdinal, lastOrdinal);
        expectedOrdinal = progress.expectedOrdinal;
        lastOrdinal = progress.lastOrdinal;
        if (progress.done) {
            break;
        }

        consumeTranscriptRecord(parsed, state, sessionMeta);
        if (state.shouldStop) {
            return true;
        }
    }

    assertCodexTranscriptSegmentComplete(segment, lastOrdinal);
    return false;
};

export type CodexForkParentTolerance = {
    allowMissing: boolean;
    missing: CodexMissingForkParent[];
};

// Finds a fork's parent rollout. When the parent is gone and tolerance was requested, records the gap and returns null.
const resolveParentSessionFile = async (
    fork: { forkCutoff: number; parentThreadId: string; sessionFile: string },
    resolveForkedThread: CodexForkedThreadResolver,
    tolerance: CodexForkParentTolerance | undefined,
): Promise<string | null> => {
    try {
        return await resolveForkedThread(fork.parentThreadId);
    } catch (error) {
        if (!tolerance?.allowMissing) {
            throw new CodexTranscriptHistoryError(
                `Unable to resolve Codex fork parent ${fork.parentThreadId} for ${fork.sessionFile}`,
                { cause: error },
            );
        }

        tolerance.missing.push({ ordinalExclusive: fork.forkCutoff, threadId: fork.parentThreadId });
        return null;
    }
};

export const resolveCodexTranscriptSegments = async (
    sessionFile: string,
    resolveForkedThread?: CodexForkedThreadResolver,
    seenFiles = new Set<string>(),
    maxOrdinalExclusive: number | null = null,
    tolerance?: CodexForkParentTolerance,
): Promise<CodexTranscriptSegment[]> => {
    const normalizedSessionFile = path.resolve(sessionFile);
    if (seenFiles.has(normalizedSessionFile)) {
        throw new CodexTranscriptHistoryError(`Codex transcript fork cycle detected at ${sessionFile}`);
    }

    const nextSeenFiles = new Set(seenFiles).add(normalizedSessionFile);
    const forkBoundary = readForkBoundary(sessionFile, await readForkMetadata(sessionFile));
    if (!forkBoundary) {
        return [{ maxOrdinalExclusive, minOrdinalInclusive: 0, sessionFile }];
    }
    const { forkedFromId: parentThreadId, ordinalExclusive: forkCutoff } = forkBoundary;

    if (!resolveForkedThread) {
        throw new CodexTranscriptHistoryError(
            `Codex transcript ${sessionFile} requires fork history for parent ${parentThreadId ?? 'unknown'}`,
        );
    }

    const parentSessionFile = await resolveParentSessionFile(
        { forkCutoff, parentThreadId, sessionFile },
        resolveForkedThread,
        tolerance,
    );
    if (parentSessionFile === null) {
        // The parent is gone: keep only this file's own records.
        return maxOrdinalExclusive !== null && maxOrdinalExclusive <= forkCutoff
            ? []
            : [{ maxOrdinalExclusive, minOrdinalInclusive: forkCutoff, sessionFile }];
    }

    const normalizedParentSessionFile = path.resolve(parentSessionFile);
    if (nextSeenFiles.has(normalizedParentSessionFile)) {
        throw new CodexTranscriptHistoryError(`Codex transcript fork cycle detected at ${parentSessionFile}`);
    }

    const parentLimit = maxOrdinalExclusive === null ? forkCutoff : Math.min(maxOrdinalExclusive, forkCutoff);
    let parentSegments: CodexTranscriptSegment[];
    try {
        parentSegments = await resolveCodexTranscriptSegments(
            parentSessionFile,
            resolveForkedThread,
            nextSeenFiles,
            parentLimit,
            tolerance,
        );
    } catch (error) {
        if (error instanceof CodexTranscriptHistoryError) {
            throw error;
        }
        throw new CodexTranscriptHistoryError(`Unable to read Codex fork parent ${parentThreadId} for ${sessionFile}`, {
            cause: error,
        });
    }
    if (maxOrdinalExclusive !== null && maxOrdinalExclusive <= forkCutoff) {
        return parentSegments;
    }

    return [...parentSegments, { maxOrdinalExclusive, minOrdinalInclusive: forkCutoff, sessionFile }];
};

export const parseCodexTranscriptFile = async (
    sessionFile: string,
    options: ParseCodexTranscriptOptions = {},
): Promise<ParsedCodexTranscript> => {
    const missing: CodexMissingForkParent[] = [];
    const segments = await resolveCodexTranscriptSegments(sessionFile, options.resolveForkedThread, new Set(), null, {
        allowMissing: options.allowMissingForkParent === true,
        missing,
    });
    const withGaps = (transcript: ParsedCodexTranscript): ParsedCodexTranscript =>
        missing.length > 0 ? { ...transcript, missingForkParents: missing } : transcript;
    const sessionMeta = await readSessionMeta(sessionFile);
    const state = createTranscriptState(options);
    for (const [segmentIndex, segment] of segments.entries()) {
        const segmentSessionMeta = segmentIndex === segments.length - 1 ? sessionMeta : createEmptySessionMeta();
        if (await consumeTranscriptSegment(segment, state, segmentSessionMeta)) {
            return withGaps(finalizeTranscript(state, sessionMeta, options));
        }
    }
    return withGaps(finalizeTranscript(state, sessionMeta, options));
};
