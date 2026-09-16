import { Database } from 'bun:sqlite';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { runWithSqliteRetry } from './sqlite-retry';

const assertSafeLockFile = async (filePath: string): Promise<void> => {
    const info = await lstat(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) {
        throw new Error(`Unsafe mutation lock file: ${filePath}`);
    }
};

const appendCleanupError = (primary: unknown, cleanup: unknown): unknown => {
    if (primary instanceof Error) {
        try {
            const carrier = primary as Error & { cleanupErrors?: unknown[] };
            carrier.cleanupErrors = [...(carrier.cleanupErrors ?? []), cleanup];
            return primary;
        } catch {
            // Fall through when a caller supplies a frozen error object.
        }
    }
    return new AggregateError([primary, cleanup], 'Mutation lock cleanup failed', { cause: primary });
};

type MutationLockHandle = Awaited<ReturnType<typeof open>>;

const assertMutationLockIdentity = async (lockPath: string, identity: { dev: number; ino: number }) => {
    const current = await lstat(lockPath);
    if (current.ino !== identity.ino || current.dev !== identity.dev || current.nlink !== 1) {
        throw new Error(`Unsafe mutation lock file changed: ${lockPath}`);
    }
};

const assertMutationDirectoryIdentity = async (
    directory: string,
    directoryInfo: { dev: number; ino: number },
    canonicalDirectory: string,
) => {
    const current = await lstat(directory);
    if (
        !current.isDirectory() ||
        current.ino !== directoryInfo.ino ||
        current.dev !== directoryInfo.dev ||
        (await realpath(directory)) !== canonicalDirectory
    ) {
        throw new Error(`Unsafe mutation lock directory changed: ${directory}`);
    }
};

const acquireMutationLock = async ({
    canonicalDirectory,
    directory,
    directoryInfo,
    handle,
    lockPath,
}: {
    canonicalDirectory: string;
    directory: string;
    directoryInfo: { dev: number; ino: number };
    handle: MutationLockHandle;
    lockPath: string;
}): Promise<Database> => {
    const identity = await handle.stat();
    const lock = new Database(lockPath, { create: false, readwrite: true });
    try {
        await assertMutationLockIdentity(lockPath, identity);
        lock.run('PRAGMA busy_timeout = 0');
        await runWithSqliteRetry({ action: () => lock.run('BEGIN IMMEDIATE') });
        await assertMutationDirectoryIdentity(directory, directoryInfo, canonicalDirectory);
        for (const suffix of ['', '-journal', '-wal', '-shm']) {
            await assertSafeLockFile(`${lockPath}${suffix}`);
        }
        await assertMutationLockIdentity(lockPath, identity);
        return lock;
    } catch (error) {
        try {
            lock.close();
        } catch (cleanupError) {
            throw appendCleanupError(error, cleanupError);
        }
        throw error;
    }
};

const closeMutationResources = async (lock: Database | undefined, handle: MutationLockHandle): Promise<unknown> => {
    let cleanupError: unknown;
    if (lock) {
        try {
            lock.close();
        } catch (error) {
            cleanupError = error;
        }
    }
    try {
        await handle.close();
    } catch (error) {
        cleanupError = cleanupError === undefined ? error : appendCleanupError(cleanupError, error);
    }
    return cleanupError;
};

/**
 * Serializes cooperating Spiracha source-file writers through a SQLite transaction.
 * Requires an existing non-symlink directory and passes its canonical path to the
 * awaited action; use that path and keep owned asynchronous work inside the action.
 * SQLite releases the lock on process death, but does not undo source-file changes
 * or coordinate native application writers. Caller recovery protocols remain needed.
 * Cleanup can throw after a successful action or be attached to its primary error;
 * an exception does not prove that the action made no persistent changes.
 */
export const withFileMutationLock = async <T>(
    directory: string,
    action: (canonicalDirectory: string) => Promise<T>,
): Promise<T> => {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
        throw new Error(`Unsafe mutation lock directory: ${directory}`);
    }
    const canonicalDirectory = await realpath(directory);
    const lockPath = path.join(canonicalDirectory, '.spiracha-mutation-lock.sqlite');
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
        await assertSafeLockFile(`${lockPath}${suffix}`);
    }
    const handle = await open(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    let result!: T;
    let primaryError: unknown;
    let hasPrimaryError = false;
    let lock: Database | undefined;
    try {
        lock = await acquireMutationLock({ canonicalDirectory, directory, directoryInfo, handle, lockPath });
        result = await action(canonicalDirectory);
    } catch (error) {
        hasPrimaryError = true;
        primaryError = error;
    }
    const cleanupError = await closeMutationResources(lock, handle);
    if (hasPrimaryError) {
        throw cleanupError === undefined ? primaryError : appendCleanupError(primaryError, cleanupError);
    }
    if (cleanupError !== undefined) {
        throw cleanupError;
    }
    return result;
};
