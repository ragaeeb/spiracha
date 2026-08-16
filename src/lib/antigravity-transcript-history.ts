import { realpath } from 'node:fs/promises';
import path from 'node:path';

type GitResult = {
    stdout: string;
};

type TranscriptSnapshot = {
    content: string;
    minimumStepIndex: number;
};

type CachedHistory = {
    bytes: number;
    contents: string[];
};

export type AntigravityParseDiagnostic = {
    byteOffset: number | null;
    kind: 'jsonl' | 'protobuf';
    line?: number;
    message: string;
    stepIndex?: number;
    truncated?: boolean;
};

export type AntigravityJsonlReadResult<T> = {
    diagnostics: AntigravityParseDiagnostic[];
    records: T[];
};

const DEFAULT_JSONL_MAX_LINE_BYTES = 1024 * 1024;

const MAX_HISTORY_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_HISTORY_CACHE_ENTRIES = 32;
const historyCache = new Map<string, CachedHistory>();
let historyCacheBytes = 0;

const runGit = async (cwd: string, args: string[]): Promise<GitResult | null> => {
    try {
        const process = Bun.spawn(['git', '-C', cwd, ...args], {
            stderr: 'pipe',
            stdout: 'pipe',
        });
        const [exitCode, stdout] = await Promise.all([
            process.exited,
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
        ]);
        return exitCode === 0 ? { stdout } : null;
    } catch {
        return null;
    }
};

const parseJsonlLine = <T>(
    line: string,
    lineNumber: number,
    byteOffset: number,
    parse: (line: string) => T,
    diagnostics: AntigravityParseDiagnostic[],
    records: T[],
    maxLineBytes: number,
): void => {
    const lineBytes = Buffer.byteLength(line);
    if (lineBytes > maxLineBytes) {
        diagnostics.push({
            byteOffset,
            kind: 'jsonl',
            line: lineNumber,
            message: `Antigravity JSONL line exceeds ${maxLineBytes} bytes`,
            truncated: true,
        });
        return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
        return;
    }

    try {
        records.push(parse(trimmed));
    } catch {
        diagnostics.push({
            byteOffset,
            kind: 'jsonl',
            line: lineNumber,
            message: 'Invalid Antigravity JSONL record',
        });
    }
};

export const parseAntigravityJsonlText = <T>(
    content: string,
    parse: (line: string) => T,
    options: { maxLineBytes?: number } = {},
): AntigravityJsonlReadResult<T> => {
    const diagnostics: AntigravityParseDiagnostic[] = [];
    const records: T[] = [];
    const maxLineBytes = options.maxLineBytes ?? DEFAULT_JSONL_MAX_LINE_BYTES;
    let lineStart = 0;
    let byteOffset = 0;
    let lineNumber = 1;
    while (lineStart < content.length) {
        const newline = content.indexOf('\n', lineStart);
        const hasNewline = newline >= 0;
        const lineEnd = hasNewline ? newline : content.length;
        const line = content.slice(lineStart, lineEnd).replace(/\r$/u, '');
        parseJsonlLine(line, lineNumber, byteOffset, parse, diagnostics, records, maxLineBytes);
        byteOffset += Buffer.byteLength(content.slice(lineStart, lineEnd)) + (hasNewline ? 1 : 0);
        lineStart = hasNewline ? lineEnd + 1 : content.length;
        lineNumber += 1;
    }
    return { diagnostics, records };
};

type JsonlStreamState = {
    discardingOverlongLine: boolean;
    lineBytesSeen: number;
    lineNumber: number;
    lineOffset: number;
    pending: string;
    pendingBytes: number;
};

type JsonlFragmentInput<T> = {
    diagnostics: AntigravityParseDiagnostic[];
    fragment: string;
    hasNewline: boolean;
    maxLineBytes: number;
    parse: (line: string) => T;
    records: T[];
    state: JsonlStreamState;
};

const consumeJsonlFragment = <T>({
    diagnostics,
    fragment,
    hasNewline,
    maxLineBytes,
    parse,
    records,
    state,
}: JsonlFragmentInput<T>) => {
    const fragmentBytes = Buffer.byteLength(fragment);
    const fullLineBytes = state.lineBytesSeen + fragmentBytes;
    state.lineBytesSeen = fullLineBytes;
    if (fullLineBytes > maxLineBytes && !state.discardingOverlongLine) {
        diagnostics.push({
            byteOffset: state.lineOffset,
            kind: 'jsonl',
            line: state.lineNumber,
            message: `Antigravity JSONL line exceeds ${maxLineBytes} bytes`,
            truncated: true,
        });
        state.discardingOverlongLine = true;
        state.pending = '';
        state.pendingBytes = 0;
    }

    if (!hasNewline) {
        if (!state.discardingOverlongLine) {
            state.pending += fragment;
            state.pendingBytes = fullLineBytes;
        }
        return;
    }

    if (!state.discardingOverlongLine) {
        parseJsonlLine(
            `${state.pending}${fragment}`,
            state.lineNumber,
            state.lineOffset,
            parse,
            diagnostics,
            records,
            maxLineBytes,
        );
    }
    state.lineOffset += state.lineBytesSeen + 1;
    state.lineNumber += 1;
    state.pending = '';
    state.pendingBytes = 0;
    state.lineBytesSeen = 0;
    state.discardingOverlongLine = false;
};

const consumeJsonlText = <T>(
    text: string,
    state: JsonlStreamState,
    input: Omit<JsonlFragmentInput<T>, 'fragment' | 'hasNewline' | 'state'>,
) => {
    let start = 0;
    while (start < text.length) {
        const newline = text.indexOf('\n', start);
        const hasNewline = newline >= 0;
        const end = hasNewline ? newline : text.length;
        const fragment = text.slice(start, end).replace(/\r$/u, '');
        consumeJsonlFragment({ ...input, fragment, hasNewline, state });
        start = hasNewline ? end + 1 : text.length;
    }
};

export const readAntigravityJsonlFile = async <T>(
    filePath: string,
    parse: (line: string) => T,
    options: { maxLineBytes?: number } = {},
): Promise<AntigravityJsonlReadResult<T>> => {
    const diagnostics: AntigravityParseDiagnostic[] = [];
    const records: T[] = [];
    const maxLineBytes = options.maxLineBytes ?? DEFAULT_JSONL_MAX_LINE_BYTES;
    const reader = Bun.file(filePath).stream().getReader();
    const decoder = new TextDecoder();
    const state: JsonlStreamState = {
        discardingOverlongLine: false,
        lineBytesSeen: 0,
        lineNumber: 1,
        lineOffset: 0,
        pending: '',
        pendingBytes: 0,
    };
    const consume = (text: string) => consumeJsonlText(text, state, { diagnostics, maxLineBytes, parse, records });

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            consume(decoder.decode());
            break;
        }
        consume(decoder.decode(value, { stream: true }));
    }
    if (state.pending || state.pendingBytes > 0) {
        if (!state.discardingOverlongLine) {
            parseJsonlLine(
                state.pending,
                state.lineNumber,
                state.lineOffset,
                parse,
                diagnostics,
                records,
                maxLineBytes,
            );
        }
    }

    return { diagnostics, records };
};

const getMinimumStepIndex = (content: string): number | null => {
    let minimum: number | null = null;
    const result = parseAntigravityJsonlText(content, (line) => JSON.parse(line) as { step_index?: unknown });
    for (const entry of result.records) {
        const stepIndex = entry.step_index;
        if (typeof stepIndex === 'number' && Number.isFinite(stepIndex)) {
            minimum = minimum === null ? stepIndex : Math.min(minimum, stepIndex);
        }
    }
    return minimum;
};

const readSnapshot = async (
    repositoryRoot: string,
    relativeTranscriptPath: string,
    revision: string,
): Promise<TranscriptSnapshot | null> => {
    const result = await runGit(repositoryRoot, ['show', `${revision}:${relativeTranscriptPath}`]);
    if (!result) {
        return null;
    }

    const minimumStepIndex = getMinimumStepIndex(result.stdout);
    return minimumStepIndex === null ? null : { content: result.stdout, minimumStepIndex };
};

const findEarlierSnapshot = async (
    repositoryRoot: string,
    relativeTranscriptPath: string,
    revisions: string[],
    startIndex: number,
    threshold: number,
): Promise<{ index: number; snapshot: TranscriptSnapshot } | null> => {
    const snapshots = new Map<number, TranscriptSnapshot | null>();
    const snapshotAt = async (index: number) => {
        if (!snapshots.has(index)) {
            snapshots.set(index, await readSnapshot(repositoryRoot, relativeTranscriptPath, revisions[index]!));
        }
        return snapshots.get(index) ?? null;
    };

    let low = startIndex;
    let high = revisions.length - 1;
    let candidateIndex = -1;
    // Antigravity advances the first retained step when it commits each rolling transcript window.
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const snapshot = await snapshotAt(middle);
        if (snapshot && snapshot.minimumStepIndex < threshold) {
            candidateIndex = middle;
            high = middle - 1;
        } else {
            low = middle + 1;
        }
    }

    if (candidateIndex < 0) {
        return null;
    }
    const snapshot = await snapshotAt(candidateIndex);
    return snapshot ? { index: candidateIndex, snapshot } : null;
};

const cacheHistory = (key: string, contents: string[]): void => {
    const bytes = contents.reduce((total, content) => total + Buffer.byteLength(content), 0);
    if (bytes > MAX_HISTORY_CACHE_BYTES) {
        return;
    }

    const existing = historyCache.get(key);
    if (existing) {
        historyCache.delete(key);
        historyCacheBytes -= existing.bytes;
    }
    while (historyCache.size >= MAX_HISTORY_CACHE_ENTRIES || historyCacheBytes + bytes > MAX_HISTORY_CACHE_BYTES) {
        const oldest = historyCache.entries().next().value as [string, CachedHistory] | undefined;
        if (!oldest) {
            break;
        }
        historyCache.delete(oldest[0]);
        historyCacheBytes -= oldest[1].bytes;
    }
    historyCache.set(key, { bytes, contents });
    historyCacheBytes += bytes;
};

const getCachedHistory = (key: string): string[] | null => {
    const cached = historyCache.get(key);
    if (!cached) {
        return null;
    }

    historyCache.delete(key);
    historyCache.set(key, cached);
    return cached.contents;
};

export const readAntigravityTranscriptHistory = async (
    transcriptPath: string,
    currentMinimumStepIndex: number | null,
): Promise<string[]> => {
    if (currentMinimumStepIndex === null || currentMinimumStepIndex <= 0) {
        return [];
    }

    const transcriptDirectory = path.dirname(transcriptPath);
    const rootResult = await runGit(transcriptDirectory, ['rev-parse', '--show-toplevel']);
    const repositoryRoot = rootResult?.stdout.trim();
    if (!repositoryRoot) {
        return [];
    }

    const canonicalTranscriptPath = await realpath(transcriptPath).catch(() => null);
    if (!canonicalTranscriptPath) {
        return [];
    }
    const relativeTranscriptPath = path.relative(repositoryRoot, canonicalTranscriptPath);
    if (
        !relativeTranscriptPath ||
        relativeTranscriptPath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeTranscriptPath)
    ) {
        return [];
    }

    const logResult = await runGit(repositoryRoot, ['log', '--format=%H', '--', relativeTranscriptPath]);
    const revisions = logResult?.stdout.split(/\r?\n/u).filter(Boolean) ?? [];
    if (revisions.length === 0) {
        return [];
    }

    const cacheKey = `${repositoryRoot}\0${relativeTranscriptPath}\0${revisions[0]}\0${currentMinimumStepIndex}`;
    const cached = getCachedHistory(cacheKey);
    if (cached) {
        return cached;
    }

    const snapshots: TranscriptSnapshot[] = [];
    let startIndex = 0;
    let threshold = currentMinimumStepIndex;
    while (startIndex < revisions.length && threshold > 0) {
        const earlier = await findEarlierSnapshot(
            repositoryRoot,
            relativeTranscriptPath,
            revisions,
            startIndex,
            threshold,
        );
        if (!earlier) {
            break;
        }

        snapshots.push(earlier.snapshot);
        threshold = earlier.snapshot.minimumStepIndex;
        startIndex = earlier.index + 1;
    }

    const contents = snapshots.reverse().map((snapshot) => snapshot.content);
    cacheHistory(cacheKey, contents);
    return contents;
};
