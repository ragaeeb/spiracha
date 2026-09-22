import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import type { ParsedCodexTranscript } from './codex-browser-types';
import {
    consumeTranscriptRecord,
    createEmptySessionMeta,
    createTranscriptState,
    finalizeTranscript,
    type ParseCodexTranscriptOptions,
} from './codex-transcript-records';
import { readJsonlObjects } from './shared';

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

const SESSION_META_RECORD_PATTERN = /"type"\s*:\s*"session_meta"/u;
const FORKED_THREAD_ID_PATTERN = /"forked_from_id"\s*:\s*(?:"([^"\\]*)"|null)/u;
const FORKED_THREAD_ORDINAL_PATTERN = /"forked_from_ordinal_exclusive"\s*:\s*(?:(-?\d+(?:\.\d+)?)|null)/u;

const readForkMetadata = async (sessionFile: string) => {
    const lines = createInterface({
        crlfDelay: Number.POSITIVE_INFINITY,
        input: createReadStream(sessionFile, { encoding: 'utf8' }),
    });
    for await (const line of lines) {
        if (!SESSION_META_RECORD_PATTERN.test(line)) {
            continue;
        }

        const parentMatch = FORKED_THREAD_ID_PATTERN.exec(line);
        const cutoffMatch = FORKED_THREAD_ORDINAL_PATTERN.exec(line);
        return {
            forkedFromId: parentMatch?.[1] ?? null,
            forkedFromOrdinalExclusive: cutoffMatch?.[1] === undefined ? null : Number(cutoffMatch[1]),
        };
    }

    return { forkedFromId: null, forkedFromOrdinalExclusive: null };
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

type SegmentOrdinalProgress = {
    done: boolean;
    expectedOrdinal: number | null;
    lastOrdinal: number | null;
};

const readSegmentOrdinal = (
    parsed: Record<string, unknown>,
    segment: CodexTranscriptSegment,
    expectedOrdinal: number | null,
    lastOrdinal: number | null,
): SegmentOrdinalProgress => {
    if (segment.maxOrdinalExclusive === null) {
        return { done: false, expectedOrdinal, lastOrdinal };
    }

    if (typeof parsed.ordinal !== 'number' || !Number.isInteger(parsed.ordinal)) {
        throw new CodexTranscriptHistoryError(
            `Codex transcript ${segment.sessionFile} is missing an ordinal before fork boundary ${segment.maxOrdinalExclusive}`,
        );
    }
    if (parsed.ordinal >= segment.maxOrdinalExclusive) {
        return { done: true, expectedOrdinal, lastOrdinal };
    }
    if (
        (expectedOrdinal === null && parsed.ordinal !== segment.minOrdinalInclusive) ||
        (expectedOrdinal !== null && parsed.ordinal !== expectedOrdinal)
    ) {
        throw new CodexTranscriptHistoryError(
            `Codex transcript ${segment.sessionFile} has a gap before fork boundary ${segment.maxOrdinalExclusive}`,
        );
    }
    return {
        done: false,
        expectedOrdinal: parsed.ordinal + 1,
        lastOrdinal: parsed.ordinal,
    };
};

const assertSegmentComplete = (segment: CodexTranscriptSegment, lastOrdinal: number | null) => {
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
        const progress = readSegmentOrdinal(parsed, segment, expectedOrdinal, lastOrdinal);
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

    assertSegmentComplete(segment, lastOrdinal);
    return false;
};

export const resolveCodexTranscriptSegments = async (
    sessionFile: string,
    resolveForkedThread?: CodexForkedThreadResolver,
    seenFiles = new Set<string>(),
    maxOrdinalExclusive: number | null = null,
): Promise<CodexTranscriptSegment[]> => {
    const normalizedSessionFile = path.resolve(sessionFile);
    if (seenFiles.has(normalizedSessionFile)) {
        throw new CodexTranscriptHistoryError(`Codex transcript fork cycle detected at ${sessionFile}`);
    }

    const nextSeenFiles = new Set(seenFiles).add(normalizedSessionFile);
    const forkMetadata = await readForkMetadata(sessionFile);
    const parentThreadId = forkMetadata.forkedFromId;
    const forkCutoff = forkMetadata.forkedFromOrdinalExclusive;
    if (parentThreadId === null && forkCutoff === null) {
        return [{ maxOrdinalExclusive, minOrdinalInclusive: 0, sessionFile }];
    }

    if (!resolveForkedThread) {
        throw new CodexTranscriptHistoryError(
            `Codex transcript ${sessionFile} requires fork history for parent ${parentThreadId ?? 'unknown'}`,
        );
    }

    if (parentThreadId === null || forkCutoff === null || !Number.isInteger(forkCutoff) || forkCutoff < 0) {
        throw new CodexTranscriptHistoryError(`Codex transcript ${sessionFile} has invalid fork history metadata`);
    }
    let parentSessionFile: string;
    try {
        parentSessionFile = await resolveForkedThread(parentThreadId);
    } catch (error) {
        throw new CodexTranscriptHistoryError(
            `Unable to resolve Codex fork parent ${parentThreadId} for ${sessionFile}`,
            { cause: error },
        );
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
    const segments = await resolveCodexTranscriptSegments(sessionFile, options.resolveForkedThread);
    const sessionMeta = await readSessionMeta(sessionFile);
    const state = createTranscriptState(options);
    for (const [segmentIndex, segment] of segments.entries()) {
        const segmentSessionMeta = segmentIndex === segments.length - 1 ? sessionMeta : createEmptySessionMeta();
        if (await consumeTranscriptSegment(segment, state, segmentSessionMeta)) {
            return finalizeTranscript(state, sessionMeta, options);
        }
    }
    return finalizeTranscript(state, sessionMeta, options);
};
