import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { SourceMutationConflictError } from './conversation-data/operation-types';
import type { ConversationCleanupFailure, DeleteConversationResult } from './conversation-data/types';
import { withFileMutationLock } from './file-mutation-lock';
import {
    groupQoderRecords,
    isQoderGlobalStateDatabase,
    listQoderWorkspaceStorageIds,
    locateQoderStatePath,
    parseLocalHistoryRows,
    parseTaskSnapshotRows,
    pathExists,
    QODER_LOCAL_HISTORY_KEY_PATTERN,
    QODER_TASK_SNAPSHOT_KEY,
    type QoderItemTableRow,
    type QoderSessionRecord,
    type QoderTaskEntry,
    readQoderItemTableRows,
} from './qoder-storage';
import { asJsonObject, parseJsonValue } from './qoder-transcript-parser';
import { asObject, asString, type JsonValue } from './shared-text';

const EXECUTION_SUFFIX = '.session.execution';
const INTENT_PREFIX = '.spiracha-qoder-delete-';
const MAX_INTENT_BYTES = 8 * 1024 * 1024;
const QODER_PROCESS_NAME = 'Qoder';

export type QoderMutationLocations = {
    cliProjectsDir: string;
    globalStateDb: string;
    workspaceStorageDir: string;
};

export type QoderMutationHooks = {
    afterCommit?: () => Promise<void>;
    afterIntent?: () => Promise<void>;
    isWriterRunning?: () => Promise<boolean>;
    unlinkFile?: (filePath: string) => Promise<void>;
};

export type QoderFileIdentity = {
    dev: number;
    ino: number;
    mtimeMs: number;
    nlink: number;
    path: string;
    size: number;
};

export type QoderItemTableEdit = {
    key: string;
    nextValue: string;
    originalDigest: string;
    originalValue: string;
};

export type QoderTaskPlan =
    | { action: 'remove_task'; folder: string; taskId: string }
    | { action: 'clear_fields'; clearedFields: string[]; folder: string; taskId: string };

export type QoderDeletionPlan = {
    affectedSessionIds: string[];
    canonicalSessionId: string;
    historyRemovals: Array<{ key: string; preservedIds: string[]; removedIds: string[] }>;
    itemTableEdits: QoderItemTableEdit[];
    ownedFiles: QoderFileIdentity[];
    preservedTaskIds: string[];
    requestedId: string;
    taskPlan: QoderTaskPlan[];
};

type QoderDeletionIntent = {
    canonicalRoot: string;
    committed: boolean;
    deletedFiles: string[];
    originatingStore: string;
    plan: QoderDeletionPlan;
    version: 1;
};

type QoderProcess = { exited: PromiseLike<number> };
type QoderProcessFactory = () => QoderProcess;

const spawnQoderProcess: QoderProcessFactory = () =>
    Bun.spawn(['pgrep', '-x', QODER_PROCESS_NAME], { stderr: 'ignore', stdout: 'ignore' });

const conflict = (id: string, reason: string, reasonCode: string, details: Record<string, string> = {}) =>
    new SourceMutationConflictError('qoder', id, reason, reasonCode, details);

const digestValue = (value: string): string => createHash('sha256').update(value).digest('hex');

const executionAlias = (sessionId: string): string => `${sessionId}${EXECUTION_SUFFIX}`;

const stripExecutionAlias = (sessionId: string): string | null =>
    sessionId.endsWith(EXECUTION_SUFFIX) ? sessionId.slice(0, -EXECUTION_SUFFIX.length) : null;

const withExecutionAliases = (sessionId: string): string[] => {
    const stripped = stripExecutionAlias(sessionId);
    return stripped ? [sessionId, stripped] : [sessionId, executionAlias(sessionId)];
};

const isUnsafeQoderSessionId = (sessionId: string): boolean =>
    sessionId.length === 0 || sessionId === '.' || sessionId === '..' || /[\\/\0]/u.test(sessionId);

const taskExecutionSessionId = (task: QoderTaskEntry): string | null => asString(task.raw.executionSessionId ?? null);

const taskDesignSessionId = (task: QoderTaskEntry): string | null => asString(task.raw.designSessionId ?? null);

const aliasesForRecord = (record: QoderSessionRecord): Set<string> => {
    const ids = new Set(withExecutionAliases(record.sessionId));
    const task = record.task;
    if (!task) {
        return ids;
    }
    const executionSessionId = taskExecutionSessionId(task);
    const designSessionId = taskDesignSessionId(task);
    if (executionSessionId === record.sessionId) {
        ids.add(executionSessionId);
    }
    if (designSessionId === record.sessionId) {
        ids.add(designSessionId);
    }
    if (record.sessionId === task.id || record.sessionId === executionAlias(task.id)) {
        ids.add(task.id);
        ids.add(executionAlias(task.id));
    }
    return ids;
};

const getCliWorkspaceDirectoryName = (worktree: string): string => worktree.replace(/[\\/]+/gu, '-');

const listCliTranscriptCandidates = (cliProjectsDir: string, record: QoderSessionRecord): string[] => [
    path.join(cliProjectsDir, `${record.sessionId}.jsonl`),
    path.join(cliProjectsDir, getCliWorkspaceDirectoryName(record.worktree), `${record.sessionId}.jsonl`),
];

const writerCheckUnavailable = (detail?: string): Error =>
    conflict(
        '',
        `Unable to verify whether Qoder is running${detail ? `: ${detail}` : ''}. Quit Qoder and retry before deleting.`,
        'writer_check_unavailable',
    );

export const isQoderRunning = async (spawnProcess: QoderProcessFactory = spawnQoderProcess): Promise<boolean> => {
    let exitCode: number;
    try {
        exitCode = await spawnProcess().exited;
    } catch {
        throw writerCheckUnavailable();
    }
    if (exitCode === 0) {
        return true;
    }
    if (exitCode === 1) {
        return false;
    }
    throw writerCheckUnavailable(`pgrep exited with status ${exitCode}`);
};

const requireStoppedQoderWriter = async (isWriterRunning: () => Promise<boolean>, requestedId: string) => {
    if (await isWriterRunning()) {
        throw conflict(requestedId, 'Quit Qoder and retry before deleting.', 'writer_running');
    }
};

const assertContainedPath = async (filePath: string, root: string, id: string) => {
    const [realFile, realRoot] = await Promise.all([realpath(filePath), realpath(root)]);
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) {
        throw conflict(id, `Refusing to mutate a path outside the Qoder store: ${filePath}`, 'unsafe_path', {
            path: filePath,
        });
    }
};

const captureFileIdentity = async (filePath: string, root: string, id: string): Promise<QoderFileIdentity | null> => {
    const info = await lstat(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    if (!info) {
        return null;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
        throw conflict(id, `Unsafe Qoder file identity: ${filePath}`, 'unsafe_path', { path: filePath });
    }
    await assertContainedPath(filePath, root, id);
    return {
        dev: info.dev,
        ino: info.ino,
        mtimeMs: info.mtimeMs,
        nlink: info.nlink,
        path: filePath,
        size: info.size,
    };
};

const requireHistoryArray = (row: QoderItemTableRow, id: string): JsonValue[] => {
    const parsed = parseJsonValue(row.value);
    if (!Array.isArray(parsed)) {
        throw conflict(id, `Qoder history key ${row.key} is not a JSON array.`, 'malformed_store', { key: row.key });
    }
    for (const item of parsed) {
        const raw = asJsonObject(item);
        if (!raw || !asString(raw.sessionId ?? null)) {
            throw conflict(id, `Qoder history key ${row.key} contains a malformed record.`, 'malformed_store', {
                key: row.key,
            });
        }
    }
    return parsed;
};

const requireTaskFolder = (folder: string, folderValue: JsonValue, id: string, seenTaskIds: Set<string>) => {
    const folderEntry = asObject(folderValue);
    if (!folderEntry || !Array.isArray(folderEntry.tasks)) {
        throw conflict(id, `Qoder task folder ${folder} is malformed.`, 'malformed_store', { folder });
    }
    for (const item of folderEntry.tasks) {
        const raw = asJsonObject(item);
        const taskId = asString(raw?.id ?? null);
        if (!raw || !taskId) {
            throw conflict(id, `Qoder task folder ${folder} contains a malformed task.`, 'malformed_store', {
                folder,
            });
        }
        if (seenTaskIds.has(taskId)) {
            throw conflict(id, `Qoder task ${taskId} is duplicated across folders.`, 'ownership_conflict', {
                taskId,
            });
        }
        seenTaskIds.add(taskId);
    }
};

const requireTaskSnapshot = (value: string, id: string): Record<string, JsonValue> => {
    const snapshot = asJsonObject(parseJsonValue(value));
    const folders = asObject(snapshot?.folders ?? null);
    if (!snapshot || !folders) {
        throw conflict(id, 'Qoder task snapshot is not a folders object.', 'malformed_store', {
            key: QODER_TASK_SNAPSHOT_KEY,
        });
    }
    const seenTaskIds = new Set<string>();
    for (const [folder, folderValue] of Object.entries(folders)) {
        requireTaskFolder(folder, folderValue, id, seenTaskIds);
    }
    return snapshot;
};

const validateMutationRows = (rows: QoderItemTableRow[], id: string) => {
    for (const row of rows) {
        if (QODER_LOCAL_HISTORY_KEY_PATTERN.test(row.key)) {
            requireHistoryArray(row, id);
        }
        if (row.key === QODER_TASK_SNAPSHOT_KEY) {
            requireTaskSnapshot(row.value, id);
        }
    }
};

const findSelectedRecord = (records: QoderSessionRecord[], requestedId: string): QoderSessionRecord | null => {
    const matches = records.filter((record) => aliasesForRecord(record).has(requestedId));
    if (matches.length > 1) {
        throw conflict(
            requestedId,
            'Qoder session id is ambiguous across independently owned sessions.',
            'ownership_conflict',
            { sessionId: requestedId },
        );
    }
    return matches[0] ?? null;
};

const isDerivedTaskAlias = (task: QoderTaskEntry, sessionId: string): boolean =>
    sessionId === task.id || sessionId === executionAlias(task.id);

const isClearableTaskField = (task: QoderTaskEntry, field: 'designSessionId' | 'executionSessionId'): boolean => {
    const value = field === 'designSessionId' ? taskDesignSessionId(task) : taskExecutionSessionId(task);
    return Boolean(value && !isDerivedTaskAlias(task, value));
};

const planSharedTaskEdit = (
    task: QoderTaskEntry,
    folder: string,
    selected: QoderSessionRecord,
    requestedId: string,
): QoderTaskPlan => {
    const selectedRefs = task.sessionIds.filter((sessionId) => aliasesForRecord(selected).has(sessionId));
    if (selectedRefs.some((sessionId) => isDerivedTaskAlias(task, sessionId))) {
        throw conflict(
            requestedId,
            'Qoder cannot represent removing this session while a sibling task reference remains.',
            'ownership_conflict',
            { taskId: task.id },
        );
    }
    const clearedFields: string[] = [];
    if (selected.sessionId === taskDesignSessionId(task) && isClearableTaskField(task, 'designSessionId')) {
        clearedFields.push('designSessionId');
    }
    if (selected.sessionId === taskExecutionSessionId(task) && isClearableTaskField(task, 'executionSessionId')) {
        clearedFields.push('executionSessionId');
    }
    if (clearedFields.length === 0) {
        throw conflict(
            requestedId,
            'Qoder task schema cannot represent this partial session edit.',
            'ownership_conflict',
            { taskId: task.id },
        );
    }
    return { action: 'clear_fields', clearedFields, folder, taskId: task.id };
};

const locateTaskFolder = (snapshot: Record<string, JsonValue> | null, taskId: string, requestedId: string): string => {
    const folders = asObject(snapshot?.folders ?? null) ?? {};
    for (const [folder, folderValue] of Object.entries(folders)) {
        const folderEntry = asObject(folderValue);
        const tasks = Array.isArray(folderEntry?.tasks) ? folderEntry.tasks : [];
        if (tasks.some((item) => asString(asJsonObject(item)?.id ?? null) === taskId)) {
            return folder;
        }
    }
    throw conflict(requestedId, `Qoder task ${taskId} is missing from the snapshot folders.`, 'malformed_store', {
        taskId,
    });
};

const buildHistoryEdits = (
    rows: QoderItemTableRow[],
    selected: QoderSessionRecord,
    requestedId: string,
): { edits: QoderItemTableEdit[]; historyRemovals: QoderDeletionPlan['historyRemovals'] } => {
    const edits: QoderItemTableEdit[] = [];
    const historyRemovals: QoderDeletionPlan['historyRemovals'] = [];
    for (const row of rows) {
        if (!QODER_LOCAL_HISTORY_KEY_PATTERN.test(row.key)) {
            continue;
        }
        const items = requireHistoryArray(row, requestedId);
        const removedIds: string[] = [];
        const preservedIds: string[] = [];
        const nextItems = items.filter((item) => {
            const raw = asJsonObject(item);
            const historyId = asString(raw?.id ?? null) ?? '';
            const sessionId = asString(raw?.sessionId ?? null);
            if (sessionId === selected.sessionId) {
                removedIds.push(historyId);
                return false;
            }
            preservedIds.push(historyId);
            return true;
        });
        if (removedIds.length === 0) {
            continue;
        }
        const nextValue = JSON.stringify(nextItems);
        historyRemovals.push({ key: row.key, preservedIds, removedIds });
        edits.push({
            key: row.key,
            nextValue,
            originalDigest: digestValue(row.value),
            originalValue: row.value,
        });
    }
    return { edits, historyRemovals };
};

const applyTaskItemEdit = (item: JsonValue, plan: QoderTaskPlan): JsonValue[] => {
    const taskId = asString(asJsonObject(item)?.id ?? null);
    if (taskId !== plan.taskId) {
        return [item];
    }
    if (plan.action === 'remove_task') {
        return [];
    }
    const raw = asJsonObject(item);
    if (!raw) {
        return [item];
    }
    const next = { ...raw };
    for (const field of plan.clearedFields) {
        delete next[field];
    }
    return [next];
};

const buildTaskEdit = (
    snapshotRow: QoderItemTableRow | undefined,
    plan: QoderTaskPlan | null,
    requestedId: string,
): QoderItemTableEdit | null => {
    if (!snapshotRow || !plan) {
        return null;
    }
    const snapshot = requireTaskSnapshot(snapshotRow.value, requestedId);
    const folders = asObject(snapshot.folders) ?? {};
    const folderValue = asObject(folders[plan.folder]);
    if (!folderValue || !Array.isArray(folderValue.tasks)) {
        throw conflict(requestedId, `Qoder task folder ${plan.folder} is malformed.`, 'malformed_store', {
            folder: plan.folder,
        });
    }
    const nextSnapshot = {
        ...snapshot,
        folders: {
            ...folders,
            [plan.folder]: {
                ...folderValue,
                tasks: folderValue.tasks.flatMap((item) => applyTaskItemEdit(item, plan)),
            },
        },
    };
    const nextValue = JSON.stringify(nextSnapshot);
    if (nextValue === snapshotRow.value) {
        return null;
    }
    return {
        key: QODER_TASK_SNAPSHOT_KEY,
        nextValue,
        originalDigest: digestValue(snapshotRow.value),
        originalValue: snapshotRow.value,
    };
};

const collectOwnedFiles = async (
    locations: QoderMutationLocations,
    selected: QoderSessionRecord,
    workspaceStorageIds: string[],
    requestedId: string,
): Promise<QoderFileIdentity[]> => {
    const owned: QoderFileIdentity[] = [];
    const located = await locateQoderStatePath(locations.workspaceStorageDir, workspaceStorageIds, selected);
    if (located.statePath) {
        const identity = await captureFileIdentity(located.statePath, locations.workspaceStorageDir, requestedId);
        if (identity) {
            owned.push(identity);
        }
    }
    for (const candidate of listCliTranscriptCandidates(locations.cliProjectsDir, selected)) {
        const identity = await captureFileIdentity(candidate, locations.cliProjectsDir, requestedId);
        if (identity) {
            owned.push(identity);
        }
    }
    return owned;
};

const planTaskMutation = (
    records: QoderSessionRecord[],
    selected: QoderSessionRecord,
    snapshot: Record<string, JsonValue> | null,
    requestedId: string,
): { preservedTaskIds: string[]; taskPlan: QoderTaskPlan | null } => {
    const task = selected.task;
    if (!task) {
        return { preservedTaskIds: records.flatMap((record) => (record.task ? [record.task.id] : [])), taskPlan: null };
    }
    const siblingRecords = records.filter(
        (record) => record.task?.id === task.id && record.sessionId !== selected.sessionId,
    );
    const selectedRefs = new Set(task.sessionIds.filter((sessionId) => aliasesForRecord(selected).has(sessionId)));
    const remainingRefs = task.sessionIds.filter((sessionId) => !selectedRefs.has(sessionId));
    const folder = locateTaskFolder(snapshot, task.id, requestedId);
    const preservedTaskIds = [...new Set(records.flatMap((record) => (record.task ? [record.task.id] : [])))].filter(
        (taskId) => taskId !== task.id || remainingRefs.length > 0,
    );
    if (remainingRefs.length === 0 && siblingRecords.length === 0) {
        return { preservedTaskIds, taskPlan: { action: 'remove_task', folder, taskId: task.id } };
    }
    return {
        preservedTaskIds,
        taskPlan: planSharedTaskEdit(task, folder, selected, requestedId),
    };
};

export const planQoderDeletion = async (
    locations: QoderMutationLocations,
    requestedId: string,
): Promise<QoderDeletionPlan | null> => {
    if (isUnsafeQoderSessionId(requestedId)) {
        return null;
    }
    if (!(await isQoderGlobalStateDatabase(locations.globalStateDb))) {
        return null;
    }
    const [rows, workspaceStorageIds] = await Promise.all([
        readQoderItemTableRows(locations.globalStateDb),
        listQoderWorkspaceStorageIds(locations.workspaceStorageDir),
    ]);
    validateMutationRows(rows, requestedId);
    const records = groupQoderRecords(parseLocalHistoryRows(rows), parseTaskSnapshotRows(rows));
    const selected = findSelectedRecord(records, requestedId);
    if (!selected) {
        return null;
    }
    const snapshotRow = rows.find((row) => row.key === QODER_TASK_SNAPSHOT_KEY);
    const snapshot = snapshotRow ? requireTaskSnapshot(snapshotRow.value, requestedId) : null;
    const { historyRemovals, edits: historyEdits } = buildHistoryEdits(rows, selected, requestedId);
    const { preservedTaskIds, taskPlan } = planTaskMutation(records, selected, snapshot, requestedId);
    const taskEdit = buildTaskEdit(snapshotRow, taskPlan, requestedId);
    const itemTableEdits = taskEdit ? [...historyEdits, taskEdit] : historyEdits;
    if (itemTableEdits.length === 0 && selected.histories.length === 0 && !selected.task) {
        return null;
    }
    return {
        affectedSessionIds: [...aliasesForRecord(selected)].sort(),
        canonicalSessionId: selected.sessionId,
        historyRemovals,
        itemTableEdits,
        ownedFiles: await collectOwnedFiles(locations, selected, workspaceStorageIds, requestedId),
        preservedTaskIds,
        requestedId,
        taskPlan: taskPlan ? [taskPlan] : [],
    };
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

const resolveOwnedRoots = async (locations: QoderMutationLocations) =>
    Promise.all([
        canonicalizePath(path.dirname(locations.globalStateDb)),
        canonicalizePath(locations.workspaceStorageDir),
        canonicalizePath(locations.cliProjectsDir),
    ]);

const assertReplayableQoderReceipt = async (
    intent: QoderDeletionIntent,
    intentPath: string,
    locations: QoderMutationLocations,
) => {
    if (
        intent.version !== 1 ||
        typeof intent.plan !== 'object' ||
        intent.plan === null ||
        typeof intent.committed !== 'boolean' ||
        !Array.isArray(intent.deletedFiles)
    ) {
        throw conflict('', 'Qoder deletion receipt is incompatible.', 'malformed_store', { path: intentPath });
    }
    if (!intent.canonicalRoot || !intent.originatingStore) {
        throw conflict('', 'Qoder deletion receipt is not bound to an originating store.', 'malformed_store', {
            path: intentPath,
        });
    }
    const currentRoot = await canonicalizePath(path.dirname(locations.globalStateDb));
    const currentStore = await canonicalizePath(locations.globalStateDb);
    if (intent.canonicalRoot !== currentRoot || intent.originatingStore !== currentStore) {
        throw conflict(intent.plan.requestedId, 'Qoder deletion receipt belongs to a different store.', 'unsafe_path', {
            canonicalRoot: intent.canonicalRoot,
            originatingStore: intent.originatingStore,
            path: intentPath,
        });
    }
    const roots = await resolveOwnedRoots(locations);
    const pendingPaths = await Promise.all(
        [...intent.deletedFiles, ...intent.plan.ownedFiles.map((file) => file.path), intentPath].map(canonicalizePath),
    );
    const escaped = pendingPaths.find((filePath) => !roots.some((root) => isContainedPath(filePath, root)));
    if (escaped) {
        throw conflict(
            intent.plan.requestedId,
            `Qoder deletion receipt path is outside owned roots: ${escaped}`,
            'unsafe_path',
            { path: escaped },
        );
    }
};

const classifyItemTableEdits = (dbPath: string, edits: QoderItemTableEdit[]): 'all-original' | 'all-next' | 'mixed' => {
    if (edits.length === 0) {
        return 'all-original';
    }
    let db: Database;
    try {
        db = new Database(dbPath, { create: false, readwrite: false, strict: true });
    } catch {
        return 'mixed';
    }
    try {
        const select = db.query('select value from ItemTable where key = ?');
        let originalCount = 0;
        let nextCount = 0;
        for (const edit of edits) {
            const row = select.get(edit.key) as { value: string } | null;
            if (!row) {
                return 'mixed';
            }
            if (row.value === edit.originalValue) {
                originalCount += 1;
            } else if (row.value === edit.nextValue) {
                nextCount += 1;
            } else {
                return 'mixed';
            }
        }
        if (originalCount === edits.length) {
            return 'all-original';
        }
        if (nextCount === edits.length) {
            return 'all-next';
        }
        return 'mixed';
    } finally {
        db.close();
    }
};

const intentPathFor = (storeDir: string, canonicalSessionId: string): string =>
    path.join(storeDir, `${INTENT_PREFIX}${digestValue(canonicalSessionId).slice(0, 16)}.json`);

const readIntentFile = async (intentPath: string): Promise<QoderDeletionIntent | null> => {
    const exists = await Bun.file(intentPath).exists();
    if (!exists) {
        return null;
    }
    const parsed = asJsonObject(parseJsonValue(await Bun.file(intentPath).text()));
    if (parsed?.version !== 1 || !asObject(parsed.plan ?? null)) {
        throw conflict('', 'Qoder deletion receipt is incompatible.', 'malformed_store', { path: intentPath });
    }
    return parsed as unknown as QoderDeletionIntent;
};

const writeIntentFile = async (intentPath: string, intent: QoderDeletionIntent) => {
    const contents = JSON.stringify(intent);
    if (Buffer.byteLength(contents) > MAX_INTENT_BYTES) {
        throw conflict(
            intent.plan.canonicalSessionId,
            'Qoder deletion receipt exceeds the recovery size limit.',
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

const listIntentPaths = async (storeDir: string): Promise<string[]> => {
    const entries = await readdir(storeDir, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(INTENT_PREFIX) && entry.name.endsWith('.json'))
        .map((entry) => path.join(storeDir, entry.name));
};

const findReplayIntent = async (
    storeDir: string,
    requestedId: string,
): Promise<{ intent: QoderDeletionIntent; intentPath: string } | null> => {
    for (const intentPath of await listIntentPaths(storeDir)) {
        const intent = await readIntentFile(intentPath);
        if (!intent) {
            continue;
        }
        if (
            intent.plan.requestedId === requestedId ||
            intent.plan.canonicalSessionId === requestedId ||
            intent.plan.affectedSessionIds.includes(requestedId)
        ) {
            return { intent, intentPath };
        }
    }
    return null;
};

const applyItemTableEdits = (dbPath: string, edits: QoderItemTableEdit[], requestedId: string) => {
    const db = new Database(dbPath, { create: false, readwrite: true, strict: true });
    try {
        db.exec('PRAGMA busy_timeout = 0');
        db.exec('BEGIN IMMEDIATE');
        try {
            const select = db.query('select value from ItemTable where key = ?');
            const update = db.query('update ItemTable set value = ? where key = ?');
            for (const edit of edits) {
                const row = select.get(edit.key) as { value: string } | null;
                if (!row || row.value !== edit.originalValue) {
                    throw conflict(
                        requestedId,
                        'Qoder store changed after the deletion was planned.',
                        'concurrent_modification',
                        {
                            key: edit.key,
                        },
                    );
                }
                update.run(edit.nextValue, edit.key);
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    } finally {
        db.close();
    }
};

const identitiesMatch = (current: Awaited<ReturnType<typeof lstat>>, expected: QoderFileIdentity): boolean =>
    current.dev === expected.dev &&
    current.ino === expected.ino &&
    current.size === expected.size &&
    current.mtimeMs === expected.mtimeMs &&
    current.nlink === expected.nlink &&
    current.isFile() &&
    !current.isSymbolicLink();

const unlinkOwnedFile = async (
    identity: QoderFileIdentity,
    unlinkFile: (filePath: string) => Promise<void>,
    requestedId: string,
): Promise<'deleted' | 'missing'> => {
    const info = await lstat(identity.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    if (!info) {
        return 'missing';
    }
    if (!identitiesMatch(info, identity)) {
        throw conflict(
            requestedId,
            `Qoder file changed after the deletion was planned: ${identity.path}`,
            'concurrent_modification',
            {
                path: identity.path,
            },
        );
    }
    await unlinkFile(identity.path);
    return 'deleted';
};

const removeEmptySessionDirectory = async (filePath: string) => {
    const directory = path.dirname(filePath);
    if (
        path.basename(directory) === 'chatEditingSessions' ||
        path.basename(path.dirname(directory)) !== 'chatEditingSessions'
    ) {
        return;
    }
    const entries = await readdir(directory).catch(() => ['remaining']);
    if (entries.length === 0) {
        await rmdir(directory).catch(() => undefined);
    }
};

const cleanupOneOwnedFile = async (
    identity: QoderFileIdentity,
    unlinkFile: (filePath: string) => Promise<void>,
    requestedId: string,
): Promise<string | ConversationCleanupFailure> => {
    try {
        await unlinkOwnedFile(identity, unlinkFile, requestedId);
        if (identity.path.endsWith(`${path.sep}state.json`)) {
            await removeEmptySessionDirectory(identity.path);
        }
        return identity.path;
    } catch (error) {
        if (error instanceof SourceMutationConflictError) {
            return {
                error: error.message,
                path: identity.path,
                phase: 'file-cleanup',
            };
        }
        return {
            error: error instanceof Error ? error.message : String(error),
            path: identity.path,
            phase: 'file-cleanup',
        };
    }
};

const cleanupOwnedFiles = async (
    plan: QoderDeletionPlan,
    alreadyDeleted: Set<string>,
    unlinkFile: (filePath: string) => Promise<void>,
): Promise<{ cleanupFailures: ConversationCleanupFailure[]; deletedFiles: string[] }> => {
    const deletedFiles = [...alreadyDeleted];
    const cleanupFailures: ConversationCleanupFailure[] = [];
    for (const identity of plan.ownedFiles) {
        if (alreadyDeleted.has(identity.path)) {
            continue;
        }
        const result = await cleanupOneOwnedFile(identity, unlinkFile, plan.requestedId);
        if (typeof result === 'string') {
            deletedFiles.push(result);
        } else {
            cleanupFailures.push(result);
        }
    }
    return { cleanupFailures, deletedFiles: [...new Set(deletedFiles)] };
};

const emptyDeleteResult = (): DeleteConversationResult => ({ deletedFiles: [], deletedIds: [] });

const finishCommittedCleanup = async (
    intent: QoderDeletionIntent,
    intentPath: string,
    unlinkFile: (filePath: string) => Promise<void>,
): Promise<DeleteConversationResult> => {
    const { cleanupFailures, deletedFiles } = await cleanupOwnedFiles(
        intent.plan,
        new Set(intent.deletedFiles),
        unlinkFile,
    );
    const nextIntent = { ...intent, deletedFiles };
    if (cleanupFailures.length > 0) {
        await writeIntentFile(intentPath, nextIntent);
        return {
            cleanupFailures,
            deletedFiles,
            deletedIds: [intent.plan.canonicalSessionId],
            receiptId: path.basename(intentPath),
        };
    }
    await removeIntentFile(intentPath);
    return { deletedFiles, deletedIds: [intent.plan.canonicalSessionId] };
};

const applyPlannedDeletion = async (
    locations: QoderMutationLocations,
    storeDir: string,
    plan: QoderDeletionPlan,
    hooks: QoderMutationHooks,
): Promise<DeleteConversationResult> => {
    const intentPath = intentPathFor(storeDir, plan.canonicalSessionId);
    const intent: QoderDeletionIntent = {
        canonicalRoot: await realpath(storeDir),
        committed: false,
        deletedFiles: [],
        originatingStore: await realpath(locations.globalStateDb),
        plan,
        version: 1,
    };
    await writeIntentFile(intentPath, intent);
    await hooks.afterIntent?.();
    if (plan.itemTableEdits.length > 0) {
        applyItemTableEdits(locations.globalStateDb, plan.itemTableEdits, plan.requestedId);
    }
    intent.committed = true;
    await writeIntentFile(intentPath, intent);
    await hooks.afterCommit?.();
    return finishCommittedCleanup(intent, intentPath, hooks.unlinkFile ?? unlink);
};

const deleteQoderConversationLocked = async (
    locations: QoderMutationLocations,
    requestedId: string,
    hooks: QoderMutationHooks,
): Promise<DeleteConversationResult> => {
    if (isUnsafeQoderSessionId(requestedId)) {
        return emptyDeleteResult();
    }
    const storeDir = path.dirname(locations.globalStateDb);
    const storeDirExists = await pathExists(storeDir);
    if (!storeDirExists) {
        return emptyDeleteResult();
    }
    await requireStoppedQoderWriter(hooks.isWriterRunning ?? isQoderRunning, requestedId);
    const replay = await findReplayIntent(storeDir, requestedId);
    if (replay) {
        await assertReplayableQoderReceipt(replay.intent, replay.intentPath, locations);
        if (replay.intent.committed) {
            return finishCommittedCleanup(replay.intent, replay.intentPath, hooks.unlinkFile ?? unlink);
        }
        const classification = classifyItemTableEdits(locations.globalStateDb, replay.intent.plan.itemTableEdits);
        if (classification === 'mixed') {
            throw conflict(
                requestedId,
                'Qoder store diverged from the recorded deletion receipt.',
                'concurrent_modification',
                { path: replay.intentPath },
            );
        }
        if (classification === 'all-next') {
            const committed = { ...replay.intent, committed: true };
            await writeIntentFile(replay.intentPath, committed);
            return finishCommittedCleanup(committed, replay.intentPath, hooks.unlinkFile ?? unlink);
        }
        return applyPlannedDeletion(locations, storeDir, replay.intent.plan, hooks);
    }
    const dbExists = await isQoderGlobalStateDatabase(locations.globalStateDb);
    if (!dbExists) {
        return emptyDeleteResult();
    }
    const plan = await planQoderDeletion(locations, requestedId);
    if (!plan) {
        return emptyDeleteResult();
    }
    return applyPlannedDeletion(locations, storeDir, plan, hooks);
};

export const deleteQoderConversation = async (
    requestedId: string,
    locations: QoderMutationLocations,
    hooks: QoderMutationHooks = {},
): Promise<DeleteConversationResult> => {
    const storeDir = path.dirname(locations.globalStateDb);
    if (!(await pathExists(storeDir))) {
        return emptyDeleteResult();
    }
    return withFileMutationLock(storeDir, () => deleteQoderConversationLocked(locations, requestedId, hooks));
};
