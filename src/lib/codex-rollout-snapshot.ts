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

export type CodexRolloutSnapshotOperations = {
    copy: (sourcePath: string, snapshotPath: string) => Promise<void>;
    stat: (sourcePath: string) => Promise<CodexRolloutIdentity>;
};

const defaultOperations: CodexRolloutSnapshotOperations = {
    copy: async (sourcePath, snapshotPath) => {
        await Bun.write(snapshotPath, Bun.file(sourcePath));
    },
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

const isSameIdentity = (before: CodexRolloutIdentity, after: CodexRolloutIdentity) => {
    return (
        before.changeTimeMs === after.changeTimeMs &&
        before.inode === after.inode &&
        before.modificationTimeMs === after.modificationTimeMs &&
        before.sizeBytes === after.sizeBytes
    );
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
    let before: CodexRolloutIdentity;
    try {
        before = await operations.stat(sourcePath);
    } catch (error) {
        throw new CodexRolloutSourceError({
            cause: error,
            code: isMissingError(error) ? 'CODEX_ROLLOUT_MISSING' : 'CODEX_ROLLOUT_UNREADABLE',
            sourcePath,
            threadId,
        });
    }

    try {
        await operations.copy(sourcePath, snapshotPath);
    } catch (error) {
        throw new CodexRolloutSourceError({
            cause: error,
            code: isMissingError(error) ? 'CODEX_ROLLOUT_MISSING' : 'CODEX_ROLLOUT_UNREADABLE',
            sourcePath,
            threadId,
        });
    }

    let after: CodexRolloutIdentity;
    try {
        after = await operations.stat(sourcePath);
    } catch (error) {
        throw new CodexRolloutSourceError({
            cause: error,
            code: isMissingError(error) ? 'CODEX_ROLLOUT_MISSING' : 'CODEX_ROLLOUT_UNREADABLE',
            sourcePath,
            threadId,
        });
    }

    if (!isSameIdentity(before, after)) {
        throw new CodexRolloutMutationError({ after, attempt, before, threadId });
    }

    return { after, attempt, before, snapshotPath, sourcePath, threadId };
};
