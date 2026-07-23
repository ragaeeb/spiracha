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

const getMinimumStepIndex = (content: string): number | null => {
    let minimum: number | null = null;
    for (const line of content.split(/\r?\n/u)) {
        if (!line.trim()) {
            continue;
        }

        try {
            const stepIndex = (JSON.parse(line) as { step_index?: unknown }).step_index;
            if (typeof stepIndex === 'number' && Number.isFinite(stepIndex)) {
                minimum = minimum === null ? stepIndex : Math.min(minimum, stepIndex);
            }
        } catch {
            // Historical snapshots are optional recovery evidence and may include partial writes.
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
