import { AsyncLocalStorage } from 'node:async_hooks';
import { constants } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { withFileMutationLock } from './file-mutation-lock';

const activeOperation = new AsyncLocalStorage<string>();
const journalName = '.spiracha-cursor-operation.json';

const assertRegularFile = async (filePath: string): Promise<void> => {
    const info = await lstat(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) {
        throw new Error(`Unsafe Cursor recovery file: ${filePath}`);
    }
};

const syncDirectory = async (directory: string): Promise<void> => {
    const handle = await open(directory, constants.O_RDONLY);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
};

const writeIntent = async (
    directory: string,
    intent: unknown,
    state: 'intent' | 'committed' = 'intent',
): Promise<void> => {
    const contents = JSON.stringify({ intent, state, version: 1 });
    if (Buffer.byteLength(contents) > 8 * 1024 * 1024) {
        throw new Error('Cursor recovery intent exceeds 8 MiB');
    }
    const temporaryPath = path.join(directory, `${journalName}.tmp`);
    await assertRegularFile(temporaryPath);
    const handle = await open(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o600,
    );
    try {
        await handle.writeFile(JSON.stringify({ intent, state, version: 1 }));
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temporaryPath, path.join(directory, journalName));
    await syncDirectory(directory);
};

const withOperationLock = async <T>(userDir: string, action: (directory: string) => Promise<T>): Promise<T> =>
    withFileMutationLock(userDir, (directory) => activeOperation.run(path.resolve(userDir), () => action(directory)));

const clearIntent = async (directory: string): Promise<void> => {
    await rm(path.join(directory, journalName), { force: true });
    await syncDirectory(directory);
};

export const isCursorOperationActive = (userDir: string): boolean =>
    activeOperation.getStore() === path.resolve(userDir);

/** Intent remains until every store has completed; a crash releases SQLite's writer lock. */
export const runCursorOperation = async <T>(
    userDir: string,
    intent: unknown,
    action: () => Promise<T>,
    complete: (result: T) => boolean = () => true,
): Promise<T> => {
    if (isCursorOperationActive(userDir)) {
        return action();
    }
    return withOperationLock(userDir, async (directory) => {
        const journalPath = path.join(directory, journalName);
        await assertRegularFile(journalPath);
        if (await Bun.file(journalPath).exists()) {
            throw new Error(`Cursor recovery required: ${journalPath}`);
        }
        await writeIntent(directory, intent);
        const result = await action();
        if (complete(result)) {
            await writeIntent(directory, intent, 'committed');
            await clearIntent(directory);
        }
        return result;
    });
};

export const reconcileCursorOperations = async (
    userDir: string,
    replay: (intent: unknown) => Promise<void>,
): Promise<void> => {
    if (isCursorOperationActive(userDir)) {
        return;
    }
    const journalPath = path.join(userDir, journalName);
    await assertRegularFile(journalPath);
    if (!(await Bun.file(journalPath).exists())) {
        return;
    }
    await withOperationLock(userDir, async (directory) => {
        await assertRegularFile(journalPath);
        if (!(await Bun.file(journalPath).exists())) {
            return;
        }
        const handle = await open(journalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let record: { version?: unknown; state?: unknown; intent?: unknown };
        try {
            if ((await handle.stat()).size > 8 * 1024 * 1024) {
                throw new Error('Cursor recovery intent exceeds 8 MiB');
            }
            record = JSON.parse(await handle.readFile('utf8'));
        } finally {
            await handle.close();
        }
        if (record?.version !== 1 || !record.intent || !['intent', 'committed'].includes(String(record.state))) {
            throw new Error(`Unsupported Cursor recovery record: ${journalPath}`);
        }
        try {
            if (record.state === 'intent') {
                await replay(record.intent);
                await writeIntent(directory, record.intent, 'committed');
            }
        } catch (error) {
            throw new Error(
                `Cursor recovery unresolved at ${journalPath}: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
            );
        }
        await clearIntent(directory);
    });
};
