import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DeleteCommandCodeSessionResult } from './command-code-exporter-types';
import { SourceMutationConflictError } from './conversation-data/operation-types';
import type { ConversationCleanupFailure } from './conversation-data/types';
import { withFileMutationLock } from './file-mutation-lock';
import { readDirectoryEntriesIfExists } from './shared';

const INTENT_PREFIX = '.spiracha-command-code-delete-';
const MAX_INTENT_BYTES = 8 * 1024 * 1024;
const OWNED_SUFFIXES = ['.meta.json', '.checkpoints.jsonl', '.jsonl'] as const;

export type CommandCodeFileIdentity = {
    dev: number;
    ino: number;
    mtimeMs: number;
    nlink: number;
    path: string;
    size: number;
};

export type CommandCodeDeletionPlan = {
    ownedFiles: CommandCodeFileIdentity[];
    requestedId: string;
};

export type CommandCodeMutationHooks = {
    afterIntent?: () => Promise<void>;
    isWriterRunning?: () => Promise<boolean>;
    unlinkFile?: (filePath: string) => Promise<void>;
};

type CommandCodeDeletionIntent = {
    canonicalRoot: string;
    deletedFiles: string[];
    originatingStore: string;
    plan: CommandCodeDeletionPlan;
    version: 1;
};

type CommandCodeProcess = { exited: PromiseLike<number> };
type CommandCodeProcessFactory = () => CommandCodeProcess;

const emptyResult = (): DeleteCommandCodeSessionResult => ({ deletedFiles: [], deletedSessionIds: [] });

const conflict = (id: string, reason: string, reasonCode: string, details: Record<string, string> = {}) =>
    new SourceMutationConflictError('command-code', id, reason, reasonCode, details);

const digestValue = (value: string): string => createHash('sha256').update(value).digest('hex');

const isSafeCommandCodeSessionId = (sessionId: string): boolean =>
    sessionId.length > 0 && sessionId !== '.' && sessionId !== '..' && path.basename(sessionId) === sessionId;

const intentPathFor = (projectsDir: string, sessionId: string): string =>
    path.join(projectsDir, `${INTENT_PREFIX}${digestValue(sessionId).slice(0, 16)}.json`);

const lstatIfPresent = async (filePath: string) =>
    lstat(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    });

const assertSafeOwnedFile = (filePath: string, metadata: Awaited<ReturnType<typeof lstat>>) => {
    if (!metadata.isFile() || metadata.isSymbolicLink() || Number(metadata.nlink) !== 1) {
        throw new Error(`Unsafe Command Code session file: ${filePath}`);
    }
};

const identityFrom = (filePath: string, metadata: Awaited<ReturnType<typeof lstat>>): CommandCodeFileIdentity => ({
    dev: Number(metadata.dev),
    ino: Number(metadata.ino),
    mtimeMs: Number(metadata.mtimeMs),
    nlink: Number(metadata.nlink),
    path: filePath,
    size: Number(metadata.size),
});

const identitiesMatch = (current: Awaited<ReturnType<typeof lstat>>, expected: CommandCodeFileIdentity): boolean =>
    Number(current.dev) === expected.dev &&
    Number(current.ino) === expected.ino &&
    Number(current.size) === expected.size &&
    Number(current.mtimeMs) === expected.mtimeMs &&
    Number(current.nlink) === expected.nlink &&
    current.isFile() &&
    !current.isSymbolicLink();

const isInsideProjectsDir = (projectsDir: string, filePath: string): boolean => {
    const root = path.resolve(projectsDir);
    const resolved = path.resolve(filePath);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
};

const captureOwnedFile = async (projectsDir: string, filePath: string): Promise<CommandCodeFileIdentity | null> => {
    if (!isInsideProjectsDir(projectsDir, filePath)) {
        throw conflict('', `Command Code path is outside the projects directory: ${filePath}`, 'unsafe_path', {
            path: filePath,
        });
    }
    const metadata = await lstatIfPresent(filePath);
    if (!metadata) {
        return null;
    }
    assertSafeOwnedFile(filePath, metadata);
    return identityFrom(filePath, metadata);
};

export const planCommandCodeDeletion = async (
    projectsDir: string,
    sessionId: string,
): Promise<CommandCodeDeletionPlan> => {
    if (!isSafeCommandCodeSessionId(sessionId) || !(await lstatIfPresent(projectsDir))) {
        return { ownedFiles: [], requestedId: sessionId };
    }
    const projectEntries = (await readDirectoryEntriesIfExists(projectsDir))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name));
    const ownedFiles: CommandCodeFileIdentity[] = [];
    for (const projectEntry of projectEntries) {
        const projectDir = path.join(projectsDir, projectEntry.name);
        for (const suffix of OWNED_SUFFIXES) {
            const captured = await captureOwnedFile(projectsDir, path.join(projectDir, `${sessionId}${suffix}`));
            if (captured) {
                ownedFiles.push(captured);
            }
        }
    }
    return { ownedFiles, requestedId: sessionId };
};

const spawnWriterProcess =
    (processName: string): CommandCodeProcessFactory =>
    () =>
        Bun.spawn(['pgrep', '-x', processName], { stderr: 'ignore', stdout: 'ignore' });

export const isCommandCodeWriterRunning = async (
    spawnProcess?: CommandCodeProcessFactory,
    processName = process.env.SPIRACHA_COMMAND_CODE_WRITER_PROCESS?.trim() ?? '',
): Promise<boolean> => {
    if (!processName) {
        return false;
    }
    let exitCode: number;
    try {
        exitCode = await (spawnProcess ?? spawnWriterProcess(processName))().exited;
    } catch {
        throw new Error('Unable to verify whether Command Code is running');
    }
    if (exitCode === 0) {
        return true;
    }
    if (exitCode === 1) {
        return false;
    }
    throw new Error(`Unable to verify whether Command Code is running: pgrep exited with status ${exitCode}`);
};

const canonicalizePath = async (target: string): Promise<string> => {
    try {
        return await realpath(target);
    } catch {
        const parent = path.dirname(target);
        if (parent === target) {
            return path.resolve(target);
        }
        return path.join(await canonicalizePath(parent), path.basename(target));
    }
};

const isContainedPath = (candidate: string, root: string) =>
    candidate === root || candidate.startsWith(`${root}${path.sep}`);

const assertReplayableCommandCodeReceipt = async (
    intent: CommandCodeDeletionIntent,
    intentPath: string,
    projectsDir: string,
) => {
    if (intent.version !== 1 || !Array.isArray(intent.plan?.ownedFiles) || !Array.isArray(intent.deletedFiles)) {
        throw conflict('', 'Command Code deletion receipt is incompatible.', 'malformed_store', { path: intentPath });
    }
    if (!intent.canonicalRoot || !intent.originatingStore) {
        throw conflict('', 'Command Code deletion receipt is not bound to an originating store.', 'malformed_store', {
            path: intentPath,
        });
    }
    const currentRoot = await canonicalizePath(projectsDir);
    if (intent.canonicalRoot !== currentRoot || intent.originatingStore !== currentRoot) {
        throw conflict(
            intent.plan.requestedId,
            'Command Code deletion receipt belongs to a different store.',
            'unsafe_path',
            {
                canonicalRoot: intent.canonicalRoot,
                originatingStore: intent.originatingStore,
                path: intentPath,
            },
        );
    }
    const pendingPaths = await Promise.all(
        [...intent.deletedFiles, ...intent.plan.ownedFiles.map((file) => file.path), intentPath].map(canonicalizePath),
    );
    const escaped = pendingPaths.find((filePath) => !isContainedPath(filePath, currentRoot));
    if (escaped) {
        throw conflict(
            intent.plan.requestedId,
            `Command Code deletion receipt path is outside owned roots: ${escaped}`,
            'unsafe_path',
            { path: escaped },
        );
    }
};

const readIntentFile = async (intentPath: string): Promise<CommandCodeDeletionIntent | null> => {
    if (!(await lstatIfPresent(intentPath))) {
        return null;
    }
    const parsed = JSON.parse(await Bun.file(intentPath).text()) as CommandCodeDeletionIntent;
    if (parsed.version !== 1 || !Array.isArray(parsed.plan?.ownedFiles) || !Array.isArray(parsed.deletedFiles)) {
        throw conflict('', 'Command Code deletion receipt is incompatible.', 'malformed_store', { path: intentPath });
    }
    return parsed;
};

const writeIntentFile = async (intentPath: string, intent: CommandCodeDeletionIntent) => {
    const contents = JSON.stringify(intent);
    if (Buffer.byteLength(contents) > MAX_INTENT_BYTES) {
        throw conflict(
            intent.plan.requestedId,
            'Command Code deletion receipt exceeds the recovery size limit.',
            'unsafe_path',
        );
    }
    const temporaryPath = `${intentPath}.${randomUUID()}.tmp`;
    await Bun.write(temporaryPath, contents);
    await rename(temporaryPath, intentPath);
};

const removeIntentFile = async (intentPath: string) => {
    await unlink(intentPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    });
};

const remainingOwnedFiles = (intent: CommandCodeDeletionIntent): CommandCodeFileIdentity[] => {
    const deleted = new Set(intent.deletedFiles);
    return intent.plan.ownedFiles.filter((file) => !deleted.has(file.path));
};

const unlinkOwnedFile = async (
    identity: CommandCodeFileIdentity,
    unlinkFile: (filePath: string) => Promise<void>,
): Promise<'deleted' | 'missing'> => {
    const info = await lstatIfPresent(identity.path);
    if (!info) {
        return 'missing';
    }
    if (!identitiesMatch(info, identity)) {
        throw new Error(`Command Code file changed after the deletion was planned: ${identity.path}`);
    }
    await unlinkFile(identity.path);
    return 'deleted';
};

const cleanupOneOwnedFile = async (
    identity: CommandCodeFileIdentity,
    unlinkFile: (filePath: string) => Promise<void>,
): Promise<string | ConversationCleanupFailure | null> => {
    try {
        const result = await unlinkOwnedFile(identity, unlinkFile);
        return result === 'deleted' ? identity.path : null;
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
            path: identity.path,
            phase: 'file-cleanup',
        };
    }
};

const requireStoppedWriter = async (sessionId: string, hooks: CommandCodeMutationHooks) => {
    let running: boolean;
    try {
        running = await (hooks.isWriterRunning ?? (() => isCommandCodeWriterRunning()))();
    } catch (error) {
        throw conflict(
            sessionId,
            error instanceof Error ? error.message : 'Unable to verify whether Command Code is running.',
            'writer_check_unavailable',
        );
    }
    if (running) {
        throw conflict(
            sessionId,
            'Command Code appears to be running. Quit it and retry. Spiracha’s file-mutation lock does not stop the Command Code writer.',
            'writer_running',
        );
    }
};

const finishCleanup = async (
    intentPath: string,
    intent: CommandCodeDeletionIntent,
    unlinkFile: (filePath: string) => Promise<void>,
): Promise<DeleteCommandCodeSessionResult> => {
    const deletedFiles = [...intent.deletedFiles];
    const cleanupFailures: ConversationCleanupFailure[] = [];
    for (const identity of remainingOwnedFiles(intent)) {
        const result = await cleanupOneOwnedFile(identity, unlinkFile);
        if (result === null) {
            continue;
        }
        if (typeof result === 'string') {
            deletedFiles.push(result);
        } else {
            cleanupFailures.push(result);
            const nextIntent = { ...intent, deletedFiles };
            await writeIntentFile(intentPath, nextIntent);
            return {
                cleanupFailures,
                deletedFiles,
                deletedSessionIds: deletedFiles.length > 0 ? [intent.plan.requestedId] : [],
                receiptId: path.basename(intentPath),
            };
        }
    }
    await removeIntentFile(intentPath);
    return {
        deletedFiles,
        deletedSessionIds: deletedFiles.length > 0 ? [intent.plan.requestedId] : [],
    };
};

export const deleteCommandCodeSession = async (
    projectsDir: string,
    sessionId: string,
    hooks: CommandCodeMutationHooks = {},
): Promise<DeleteCommandCodeSessionResult> => {
    if (!(await lstatIfPresent(projectsDir))) {
        return emptyResult();
    }
    return withFileMutationLock(projectsDir, async () => {
        await requireStoppedWriter(sessionId, hooks);
        const intentPath = intentPathFor(projectsDir, sessionId);
        const existingIntent = await readIntentFile(intentPath);
        if (existingIntent) {
            await assertReplayableCommandCodeReceipt(existingIntent, intentPath, projectsDir);
        }
        const plan = existingIntent?.plan ?? (await planCommandCodeDeletion(projectsDir, sessionId));
        if (plan.ownedFiles.length === 0 && !existingIntent) {
            return emptyResult();
        }
        const storeRoot = await realpath(projectsDir);
        const intent =
            existingIntent ??
            ({
                canonicalRoot: storeRoot,
                deletedFiles: [],
                originatingStore: storeRoot,
                plan,
                version: 1 as const,
            } satisfies CommandCodeDeletionIntent);
        if (!existingIntent) {
            await writeIntentFile(intentPath, intent);
        }
        await hooks.afterIntent?.();
        return finishCleanup(intentPath, intent, hooks.unlinkFile ?? unlink);
    });
};
