import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

export type CodexRolloutIdentity = {
    changeTimeMs: number;
    inode: number;
    modificationTimeMs: number;
    sizeBytes: number;
};

export type CodexRolloutSnapshot = {
    after: CodexRolloutIdentity;
    attempt: number;
    before: CodexRolloutIdentity;
    sourcePath: string;
    snapshotPath: string;
    threadId: string;
};

export class CodexRolloutMutationError extends Error {
    readonly after: CodexRolloutIdentity;
    readonly attempt: number;
    readonly before: CodexRolloutIdentity;
    readonly code = 'CODEX_ROLLOUT_MUTATED';
    readonly threadId: string;

    constructor({
        after,
        attempt,
        before,
        threadId,
    }: {
        after: CodexRolloutIdentity;
        attempt: number;
        before: CodexRolloutIdentity;
        threadId: string;
    }) {
        super(`Codex rollout changed while exporting thread ${threadId} (attempt ${attempt}).`);
        this.name = 'CodexRolloutMutationError';
        this.after = after;
        this.attempt = attempt;
        this.before = before;
        this.threadId = threadId;
    }
}

export class CodexRolloutSourceError extends Error {
    readonly code: 'CODEX_ROLLOUT_MISSING' | 'CODEX_ROLLOUT_UNREADABLE';
    readonly threadId: string;
    readonly sourcePath: string;

    constructor({
        cause,
        code,
        sourcePath,
        threadId,
    }: {
        cause?: unknown;
        code: 'CODEX_ROLLOUT_MISSING' | 'CODEX_ROLLOUT_UNREADABLE';
        sourcePath: string;
        threadId: string;
    }) {
        super(
            code === 'CODEX_ROLLOUT_MISSING'
                ? `Thread ${threadId} rollout file is missing: ${sourcePath}`
                : `Thread ${threadId} rollout file could not be read: ${sourcePath}`,
            cause === undefined ? undefined : { cause },
        );
        this.name = 'CodexRolloutSourceError';
        this.code = code;
        this.sourcePath = sourcePath;
        this.threadId = threadId;
    }
}

export class CodexRolloutContentError extends Error {
    readonly actualBytes: number;
    readonly actualHash?: string;
    readonly code = 'CODEX_ROLLOUT_CONTENT_INVALID';
    readonly expectedBytes: number;
    readonly expectedHash?: string;
    readonly threadId: string;

    constructor({
        actualBytes,
        actualHash,
        expectedBytes,
        expectedHash,
        threadId,
    }: {
        actualBytes: number;
        actualHash?: string;
        expectedBytes: number;
        expectedHash?: string;
        threadId: string;
    }) {
        super(
            actualHash === undefined || expectedHash === undefined
                ? `Thread ${threadId} rollout copy has ${actualBytes} bytes; expected ${expectedBytes}.`
                : `Thread ${threadId} rollout copy content does not match the source.`,
        );
        this.name = 'CodexRolloutContentError';
        this.actualBytes = actualBytes;
        this.actualHash = actualHash;
        this.expectedBytes = expectedBytes;
        this.expectedHash = expectedHash;
        this.threadId = threadId;
    }
}

export type CodexRolloutSnapshotOperations = {
    copy: (sourcePath: string, snapshotPath: string) => Promise<number>;
    hash: (sourcePath: string) => Promise<string>;
    stat: (sourcePath: string) => Promise<CodexRolloutIdentity>;
};

const hashFile = async (filePath: string): Promise<string> => {
    const hash = createHash('sha256');
    const reader = Bun.file(filePath).stream().getReader();
    let completed = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                completed = true;
                return hash.digest('hex');
            }

            hash.update(value);
        }
    } finally {
        if (!completed) {
            await reader.cancel().catch(() => undefined);
        }
        reader.releaseLock();
    }
};

const defaultOperations: CodexRolloutSnapshotOperations = {
    copy: async (sourcePath, snapshotPath) => {
        return Bun.write(snapshotPath, Bun.file(sourcePath));
    },
    hash: hashFile,
    stat: async (sourcePath) => {
        const metadata = await stat(sourcePath);
        return {
            changeTimeMs: metadata.ctimeMs,
            inode: metadata.ino,
            modificationTimeMs: metadata.mtimeMs,
            sizeBytes: metadata.size,
        };
    },
};

const isMissingError = (error: unknown) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
};

const runSourceOperation = async <T>(
    operation: () => Promise<T>,
    context: { sourcePath: string; threadId: string },
): Promise<T> => {
    try {
        return await operation();
    } catch (error) {
        throw new CodexRolloutSourceError({
            cause: error,
            code: isMissingError(error) ? 'CODEX_ROLLOUT_MISSING' : 'CODEX_ROLLOUT_UNREADABLE',
            ...context,
        });
    }
};

export const copyStableCodexRollout = async (
    {
        attempt,
        snapshotPath,
        sourcePath,
        threadId,
    }: {
        attempt: number;
        snapshotPath: string;
        sourcePath: string;
        threadId: string;
    },
    operations: CodexRolloutSnapshotOperations = defaultOperations,
): Promise<CodexRolloutSnapshot> => {
    const context = { sourcePath, threadId };
    const before = await runSourceOperation(() => operations.stat(sourcePath), context);
    const sourceHash = await runSourceOperation(() => operations.hash(sourcePath), context);
    const copiedBytes = await runSourceOperation(() => operations.copy(sourcePath, snapshotPath), context);
    if (copiedBytes !== before.sizeBytes) {
        throw new CodexRolloutContentError({ actualBytes: copiedBytes, expectedBytes: before.sizeBytes, threadId });
    }
    const snapshotHash = await operations.hash(snapshotPath);
    if (snapshotHash !== sourceHash) {
        throw new CodexRolloutContentError({
            actualBytes: copiedBytes,
            actualHash: snapshotHash,
            expectedBytes: before.sizeBytes,
            expectedHash: sourceHash,
            threadId,
        });
    }
    const after = await runSourceOperation(() => operations.stat(sourcePath), context);

    const finalSourceHash = await runSourceOperation(() => operations.hash(sourcePath), context);
    if (finalSourceHash !== snapshotHash) {
        throw new CodexRolloutMutationError({ after, attempt, before, threadId });
    }

    return { after, attempt, before, snapshotPath, sourcePath, threadId };
};
