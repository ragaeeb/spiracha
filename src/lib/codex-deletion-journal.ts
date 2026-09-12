import { randomUUID } from 'node:crypto';
import { lstat, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { resolveCodexDirFromDbPath } from './codex-database';
import { withFileMutationLock } from './file-mutation-lock';
import { ensurePrivateRuntimeDirectory } from './private-runtime-directory';

export type CodexDeletionIntent = {
    version: 1;
    dbPath: string;
    threadIds: string[];
    rolloutPaths: string[];
    deleteSessionFiles: boolean;
};

const journalDirectory = (dbPath: string) => path.join(resolveCodexDirFromDbPath(dbPath), '.spiracha-deletions');

const syncDirectory = async (directory: string) => {
    const handle = await open(directory, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
};

export const writeCodexDeletionIntent = async (intent: CodexDeletionIntent): Promise<string> => {
    const directory = await ensurePrivateRuntimeDirectory(journalDirectory(intent.dbPath), 'deletion journal');
    await syncDirectory(path.dirname(directory));
    const intentPath = path.join(directory, `${randomUUID()}.json`);
    const temporaryPath = `${intentPath}.tmp`;
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
        await handle.writeFile(JSON.stringify(intent));
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temporaryPath, intentPath);
    await syncDirectory(directory);
    return intentPath;
};

export const completeCodexDeletionIntent = async (intentPath: string) => {
    await rm(intentPath, { force: true });
    await syncDirectory(path.dirname(intentPath));
};

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);

const validateIntent = (value: unknown, dbPath: string): CodexDeletionIntent => {
    if (!value || typeof value !== 'object') {
        throw new Error('Invalid Codex deletion intent');
    }
    const intent = value as Partial<CodexDeletionIntent>;
    if (
        intent.version !== 1 ||
        intent.dbPath !== path.resolve(dbPath) ||
        !isStringArray(intent.threadIds) ||
        !isStringArray(intent.rolloutPaths) ||
        typeof intent.deleteSessionFiles !== 'boolean'
    ) {
        throw new Error('Invalid Codex deletion intent');
    }
    return intent as CodexDeletionIntent;
};

type JournalEntry = { intentPath: string } & (
    | { intent: CodexDeletionIntent; error?: never }
    | { intent?: never; error: string }
);

const readIntent = async (intentPath: string, dbPath: string): Promise<JournalEntry | null> => {
    try {
        const metadata = await lstat(intentPath);
        if (!metadata.isFile() || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
            throw new Error('Unsafe Codex deletion intent');
        }
        return { intent: validateIntent(await Bun.file(intentPath).json(), dbPath), intentPath };
    } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') {
            return null;
        }
        return { error: error instanceof Error ? error.message : String(error), intentPath };
    }
};

export const withCodexDeletionLock = async <T>(dbPath: string, action: () => Promise<T>): Promise<T> => {
    const directory = await ensurePrivateRuntimeDirectory(journalDirectory(dbPath), 'deletion journal');
    return withFileMutationLock(directory, action);
};

export const readCodexDeletionIntents = async (dbPath: string) => {
    const directory = journalDirectory(dbPath);
    const metadata = await lstat(directory).catch((error: unknown) => {
        if ((error as { code?: string }).code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    if (!metadata) {
        return [];
    }
    if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
        (metadata.mode & 0o077) !== 0
    ) {
        throw new Error('Unsafe Codex deletion journal');
    }
    const entries = await readdir(directory);
    const intents: JournalEntry[] = [];
    for (const entry of entries.sort()) {
        if (!/^[\da-f-]{36}\.json$/u.test(entry)) {
            continue;
        }
        const intent = await readIntent(path.join(directory, entry), dbPath);
        if (intent) {
            intents.push(intent);
        }
    }
    return intents;
};
