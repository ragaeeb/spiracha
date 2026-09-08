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

/** SQLite releases this cross-process writer lock even when its owner is killed. */
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
    try {
        const identity = await handle.stat();
        const lock = new Database(lockPath, { create: false, readwrite: true });
        try {
            const current = await lstat(lockPath);
            if (current.ino !== identity.ino || current.dev !== identity.dev || current.nlink !== 1) {
                throw new Error(`Unsafe mutation lock file changed: ${lockPath}`);
            }
            lock.run('PRAGMA busy_timeout = 0');
            await runWithSqliteRetry({ action: () => lock.run('BEGIN IMMEDIATE') });
            const finalDirectory = await lstat(directory);
            if (
                !finalDirectory.isDirectory() ||
                finalDirectory.ino !== directoryInfo.ino ||
                finalDirectory.dev !== directoryInfo.dev ||
                (await realpath(directory)) !== canonicalDirectory
            ) {
                throw new Error(`Unsafe mutation lock directory changed: ${directory}`);
            }
            for (const suffix of ['', '-journal', '-wal', '-shm']) {
                await assertSafeLockFile(`${lockPath}${suffix}`);
            }
            const finalLock = await lstat(lockPath);
            if (finalLock.ino !== identity.ino || finalLock.dev !== identity.dev) {
                throw new Error(`Unsafe mutation lock file changed: ${lockPath}`);
            }
            return await action(canonicalDirectory);
        } finally {
            lock.close();
        }
    } finally {
        await handle.close();
    }
};
