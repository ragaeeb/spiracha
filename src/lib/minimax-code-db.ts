import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import type {
    DeleteMiniMaxCodeSessionResult,
    MiniMaxCodeSessionSummary,
    MiniMaxCodeSessionTranscript,
    MiniMaxCodeTranscriptMessage,
    MiniMaxCodeWorkspaceGroup,
} from './minimax-code-exporter-types';
import {
    getDefaultMiniMaxCodeDataDir,
    resolveMiniMaxCodeDataDir,
    resolveMiniMaxCodeRuntimeDbPath,
    resolveMiniMaxCodeSessionsDir,
} from './minimax-code-exporter-types';
import {
    consumeNewMessageRow,
    createMiniMaxCodeSessionTranscript,
    createNewMessageParsingContext,
    getWorkspaceKey,
    getWorkspaceLabel,
    parseJsonValue,
    parseMiniMaxCodeSnapshotPayload,
    type ReadSnapshotOptions,
    type SessionStats,
    WORKSPACE_KEY_PREFIX,
} from './minimax-code-transcript-parser';
import { readDirectoryEntriesIfExists, readJsonlObjects } from './shared';
import { asObject, asString, type JsonValue } from './shared-text';
import { runWithSqliteRetry } from './sqlite-retry';

export {
    getDefaultMiniMaxCodeDataDir,
    resolveMiniMaxCodeDataDir,
    resolveMiniMaxCodeRuntimeDbPath,
    resolveMiniMaxCodeSessionsDir,
};

const READ_CONCURRENCY = 8;

const minimaxCodeDeleteLimiter = createConcurrencyLimiter(1);

const SIMPLE_RUNTIME_SESSION_TABLES = [
    'questionnaire_requests',
    'local_runtime_session_asset_index_state',
    'local_runtime_session_assets',
    'local_runtime_turn_diff_journal',
    'local_runtime_turn_diffs',
    'local_runtime_thread_goals',
    'local_runtime_cron_session_history',
    'local_runtime_token_usage',
    'local_runtime_session_projection_watermarks',
    'local_runtime_ledger_watermarks',
    'local_runtime_session_locks',
    'local_runtime_queue_row_migrations',
    'local_runtime_queue_items',
    'local_runtime_queues',
    'local_runtime_pi_history_row_migrations',
    'local_runtime_pi_history_rows',
    'local_runtime_message_row_migrations',
    'local_runtime_message_rows',
    'local_runtime_messages',
] as const;

const getWorktreeFromWorkspaceKey = (workspaceKey: string): string | null => {
    if (!workspaceKey.startsWith(WORKSPACE_KEY_PREFIX)) {
        return null;
    }

    try {
        return decodeURIComponent(workspaceKey.slice(WORKSPACE_KEY_PREFIX.length));
    } catch {
        return null;
    }
};

const getWorkspaceUri = (worktree: string): string => (path.isAbsolute(worktree) ? `file://${worktree}` : worktree);

const listSnapshotPaths = async (root: string): Promise<string[]> => {
    const entries = await readDirectoryEntriesIfExists(root);
    const nestedPaths = await mapWithConcurrency(
        entries.filter((entry) => entry.isDirectory()),
        READ_CONCURRENCY,
        (entry) => listSnapshotPaths(path.join(root, entry.name)),
    );
    const paths = entries
        .filter((entry) => entry.isFile() && entry.name === 'snapshot.json')
        .map((entry) => path.join(root, entry.name));
    paths.push(...nestedPaths.flat());
    return paths.sort();
};

const listManifestPaths = async (root: string): Promise<string[]> => {
    const entries = await readDirectoryEntriesIfExists(root);
    const nestedPaths = await mapWithConcurrency(
        entries.filter((entry) => entry.isDirectory()),
        READ_CONCURRENCY,
        (entry) => listManifestPaths(path.join(root, entry.name)),
    );
    const paths = entries
        .filter((entry) => entry.isFile() && entry.name === 'manifest.json')
        .map((entry) => path.join(root, entry.name));
    paths.push(...nestedPaths.flat());
    return paths.sort();
};

const listFilesRecursively = async (root: string): Promise<string[]> => {
    const entries = await readDirectoryEntriesIfExists(root);
    const files: string[] = [];
    for (const entry of entries) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFilesRecursively(entryPath)));
        } else {
            files.push(entryPath);
        }
    }
    return files;
};

const parseNewMessageLog = async (
    messagesPath: string,
    includeRawPayloads: boolean,
): Promise<MiniMaxCodeTranscriptMessage[]> => {
    const messages: MiniMaxCodeTranscriptMessage[] = [];
    const context = createNewMessageParsingContext(includeRawPayloads);
    for await (const row of readJsonlObjects(messagesPath)) {
        consumeNewMessageRow(row, context, messages);
    }
    return messages;
};

const isCompactionSummaryMessage = (message: MiniMaxCodeTranscriptMessage): boolean => {
    const content = message.content;
    return (
        message.role === 'user' &&
        Boolean(content?.startsWith('<system-reminder>')) &&
        Boolean(content?.includes('The earlier conversation history')) &&
        Boolean(content?.includes('was compacted into this structured summary:'))
    );
};

const stripLeadingSystemReminderBlocks = (message: MiniMaxCodeTranscriptMessage): MiniMaxCodeTranscriptMessage => {
    if (message.role !== 'user' || !message.content?.startsWith('<system-reminder>')) {
        return message;
    }

    const content = message.content.replace(/^\s*(?:<system-reminder>[\s\S]*?<\/system-reminder>\s*)+/u, '').trim();
    return { ...message, content: content || null };
};

const readArchivedContextMessages = async (
    sessionDir: string,
    includeRawPayloads: boolean,
): Promise<MiniMaxCodeTranscriptMessage[]> => {
    const entries = await readDirectoryEntriesIfExists(path.join(sessionDir, 'snapshots'));
    const contextPaths = entries
        .filter((entry) => entry.isFile() && entry.name.startsWith('ctx_') && entry.name.endsWith('.jsonl'))
        .map((entry) => path.join(sessionDir, 'snapshots', entry.name));
    const contexts = await mapWithConcurrency(contextPaths, READ_CONCURRENCY, async (contextPath) => ({
        contextPath,
        messages: await parseNewMessageLog(contextPath, includeRawPayloads),
    }));
    contexts.sort((left, right) => {
        const timestampDifference =
            (left.messages[0]?.createdAtMs ?? Number.MAX_SAFE_INTEGER) -
            (right.messages[0]?.createdAtMs ?? Number.MAX_SAFE_INTEGER);
        return timestampDifference || left.contextPath.localeCompare(right.contextPath);
    });
    return contexts.flatMap((context) => context.messages);
};

const mergeCompactedMessages = (
    archivedMessages: MiniMaxCodeTranscriptMessage[],
    currentMessages: MiniMaxCodeTranscriptMessage[],
): MiniMaxCodeTranscriptMessage[] => {
    if (archivedMessages.length === 0) {
        return currentMessages.map(stripLeadingSystemReminderBlocks);
    }

    const messageIds = new Set<string>();
    return [...archivedMessages, ...currentMessages]
        .filter((message) => {
            if (messageIds.has(message.messageId) || isCompactionSummaryMessage(message)) {
                return false;
            }
            messageIds.add(message.messageId);
            return true;
        })
        .map(stripLeadingSystemReminderBlocks);
};

const readSnapshot = async (
    snapshotPath: string,
    options: ReadSnapshotOptions = {},
): Promise<MiniMaxCodeSessionTranscript | null> => {
    const parsed = (await Bun.file(snapshotPath)
        .json()
        .catch(() => null)) as JsonValue | null;
    return parseMiniMaxCodeSnapshotPayload(parsed!, snapshotPath, {
        ...options,
        sessionDir: path.dirname(snapshotPath),
    });
};

const isPathInsideDirectory = (directory: string, candidate: string): boolean => {
    const relative = path.relative(path.resolve(directory), path.resolve(candidate));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const resolveManifestFilePath = (sessionDir: string, manifestValue: string): string | null => {
    const resolved = path.resolve(sessionDir, manifestValue);
    return isPathInsideDirectory(sessionDir, resolved) ? resolved : null;
};

const toRuntimeJsonValue = (value: unknown): JsonValue | null => {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return null;
};

const readRuntimeSessionRecord = (row: Record<string, unknown>): Record<string, JsonValue> | null => {
    const recordJson = asObject(typeof row.record_json === 'string' ? parseJsonValue(row.record_json) : null) ?? {};
    const extraData =
        asObject(typeof row.extra_data_json === 'string' ? parseJsonValue(row.extra_data_json) : null) ?? {};
    const record = { ...extraData, ...recordJson };
    const columnMappings = [
        ['agent_name', 'agentName'],
        ['app_mode', 'appMode'],
        ['archived', 'archived'],
        ['created_at_ms', 'createdAtMs'],
        ['effective_model', 'effectiveModel'],
        ['effective_model_variant', 'effectiveModelVariant'],
        ['project_workspace_dir', 'projectWorkspaceDir'],
        ['runtime', 'runtime'],
        ['session_type', 'sessionType'],
        ['status', 'status'],
        ['title', 'title'],
        ['updated_at_ms', 'updatedAtMs'],
        ['workspace_dir', 'workspaceDir'],
    ] as const;
    for (const [columnName, recordName] of columnMappings) {
        if (record[recordName] !== undefined) {
            continue;
        }
        const value = toRuntimeJsonValue(row[columnName]);
        if (value !== null) {
            record[recordName] = value;
        }
    }

    const sessionId =
        asString(record.sessionId ?? null)?.trim() || (typeof row.session_id === 'string' ? row.session_id.trim() : '');
    if (!sessionId) {
        return null;
    }
    record.sessionId = sessionId;
    if (record.workspaceDir === undefined && record.projectWorkspaceDir !== undefined) {
        record.workspaceDir = record.projectWorkspaceDir;
    }
    return record;
};

const hasRuntimeTable = (db: Database, tableName: string): boolean => {
    return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
};

const readRuntimeSessionRecords = async (sessionsDir: string): Promise<Map<string, Record<string, JsonValue>>> => {
    const records = new Map<string, Record<string, JsonValue>>();
    const runtimeDbPath = resolveMiniMaxCodeRuntimeDbPath(sessionsDir);
    if (!(await Bun.file(runtimeDbPath).exists())) {
        return records;
    }

    let db: Database | null = null;
    try {
        db = new Database(runtimeDbPath, { create: false, readonly: true, strict: true });
        if (!hasRuntimeTable(db, 'local_runtime_sessions')) {
            return records;
        }
        const rows = db.query('SELECT * FROM local_runtime_sessions').all() as Array<Record<string, unknown>>;
        for (const row of rows) {
            const record = readRuntimeSessionRecord(row);
            const sessionId = record ? asString(record.sessionId ?? null) : null;
            if (record && sessionId) {
                records.set(sessionId, record);
            }
        }
    } catch {
        return records;
    } finally {
        db?.close();
    }
    return records;
};

const readManifestMessagesSession = async (
    manifestPath: string,
    runtimeRecords: Map<string, Record<string, JsonValue>>,
    options: ReadSnapshotOptions = {},
): Promise<MiniMaxCodeSessionTranscript | null> => {
    const parsed = (await Bun.file(manifestPath)
        .json()
        .catch(() => null)) as JsonValue | null;
    const manifest = asObject(parsed);
    const paths = asObject(manifest?.paths ?? null);
    const sessionId = asString(manifest?.sessionId ?? null)?.trim();
    const manifestMessagesPath = asString(paths?.messages ?? null)?.trim();
    if (!manifest || !paths || !sessionId || !manifestMessagesPath) {
        return null;
    }

    const sessionDir = path.dirname(manifestPath);
    const messagesPath = resolveManifestFilePath(sessionDir, manifestMessagesPath);
    if (!messagesPath || !(await Bun.file(messagesPath).exists())) {
        return null;
    }

    const runtimeRecord = runtimeRecords.get(sessionId) ?? {};
    const record: Record<string, JsonValue> = {
        ...runtimeRecord,
        createdAtMs: runtimeRecord.createdAtMs ?? manifest.createdAtMs ?? null,
        sessionId,
        updatedAtMs: runtimeRecord.updatedAtMs ?? manifest.updatedAtMs ?? null,
    };
    const includeRawPayloads = options.includeRawPayloads ?? true;
    const [archivedMessages, currentMessages] = await Promise.all([
        readArchivedContextMessages(sessionDir, includeRawPayloads),
        parseNewMessageLog(messagesPath, includeRawPayloads),
    ]);
    const messages = mergeCompactedMessages(archivedMessages, currentMessages);
    const transcript = createMiniMaxCodeSessionTranscript({
        messages,
        record,
        sessionDir,
        sessionId,
        snapshotPath: messagesPath,
    });
    return transcript ? { ...transcript, rawPayloadsOmitted: includeRawPayloads ? undefined : true } : null;
};

const listSessionTranscripts = async (
    sessionsDir: string,
    options: ReadSnapshotOptions = {},
): Promise<MiniMaxCodeSessionTranscript[]> => {
    const [snapshotPaths, manifestPaths, runtimeRecords] = await Promise.all([
        listSnapshotPaths(sessionsDir),
        listManifestPaths(sessionsDir),
        readRuntimeSessionRecords(sessionsDir),
    ]);
    const snapshotTranscripts = await mapWithConcurrency(snapshotPaths, READ_CONCURRENCY, (snapshotPath) =>
        readSnapshot(snapshotPath, options),
    );
    const manifestTranscripts = await mapWithConcurrency(manifestPaths, READ_CONCURRENCY, (manifestPath) =>
        readManifestMessagesSession(manifestPath, runtimeRecords, options),
    );
    const transcriptsBySessionId = new Map<string, MiniMaxCodeSessionTranscript>();
    for (const transcript of [...snapshotTranscripts, ...manifestTranscripts]) {
        if (transcript?.session.messageCount && !transcriptsBySessionId.has(transcript.session.sessionId)) {
            transcriptsBySessionId.set(transcript.session.sessionId, transcript);
        }
    }
    return [...transcriptsBySessionId.values()];
};

const compareNullableMsDesc = (left: number | null, right: number | null): number => (right ?? 0) - (left ?? 0);

const sumSessions = (sessions: MiniMaxCodeSessionSummary[], key: keyof SessionStats): number => {
    return sessions.reduce((total, session) => total + session[key], 0);
};

const toWorkspaceGroup = (worktree: string, sessions: MiniMaxCodeSessionSummary[]): MiniMaxCodeWorkspaceGroup => {
    const lastActiveAtMs = sessions.reduce<number | null>((latest, session) => {
        if (session.lastActiveAtMs === null) {
            return latest;
        }
        return latest === null ? session.lastActiveAtMs : Math.max(latest, session.lastActiveAtMs);
    }, null);
    return {
        assistantMessageCount: sumSessions(sessions, 'assistantMessageCount'),
        key: getWorkspaceKey(worktree),
        label: getWorkspaceLabel(worktree),
        lastActiveAtMs,
        messageCount: sumSessions(sessions, 'messageCount'),
        reasoningCount: sumSessions(sessions, 'reasoningCount'),
        sessionCount: sessions.length,
        toolCallCount: sumSessions(sessions, 'toolCallCount'),
        toolResultCount: sumSessions(sessions, 'toolResultCount'),
        uri: getWorkspaceUri(worktree),
        userMessageCount: sumSessions(sessions, 'userMessageCount'),
        worktree,
    };
};

export const listMiniMaxCodeWorkspaceGroups = async (
    sessionsDir = resolveMiniMaxCodeSessionsDir(),
): Promise<MiniMaxCodeWorkspaceGroup[]> => {
    const transcripts = await listSessionTranscripts(sessionsDir, { includeRawPayloads: false });
    const sessionsByWorktree = new Map<string, MiniMaxCodeSessionSummary[]>();
    for (const transcript of transcripts) {
        const sessions = sessionsByWorktree.get(transcript.session.worktree) ?? [];
        sessions.push(transcript.session);
        sessionsByWorktree.set(transcript.session.worktree, sessions);
    }

    return [...sessionsByWorktree.entries()]
        .map(([worktree, sessions]) => toWorkspaceGroup(worktree, sessions))
        .sort(
            (left, right) =>
                compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) ||
                left.worktree.localeCompare(right.worktree),
        );
};

export const listMiniMaxCodeSessionsForGroup = async (
    workspaceKey: string,
    sessionsDir = resolveMiniMaxCodeSessionsDir(),
): Promise<MiniMaxCodeSessionSummary[]> => {
    const worktree = getWorktreeFromWorkspaceKey(workspaceKey);
    if (!worktree) {
        return [];
    }

    return (await listSessionTranscripts(sessionsDir, { includeRawPayloads: false }))
        .map((transcript) => transcript.session)
        .filter((session) => session.worktree === worktree)
        .sort(
            (left, right) =>
                compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) ||
                left.title.localeCompare(right.title),
        );
};

export const readMiniMaxCodeSessionTranscript = async (
    sessionsDir: string,
    sessionId: string,
    options: ReadSnapshotOptions = {},
): Promise<MiniMaxCodeSessionTranscript | null> => {
    if (!/^mvs_[A-Za-z0-9]+$/u.test(sessionId)) {
        return null;
    }

    const snapshotPaths = await listSnapshotPaths(sessionsDir);
    for (const snapshotPath of snapshotPaths) {
        const transcript = await readSnapshot(snapshotPath, options);
        if (transcript?.session.sessionId === sessionId) {
            return transcript;
        }
    }

    const [manifestPaths, runtimeRecords] = await Promise.all([
        listManifestPaths(sessionsDir),
        readRuntimeSessionRecords(sessionsDir),
    ]);
    for (const manifestPath of manifestPaths) {
        const transcript = await readManifestMessagesSession(manifestPath, runtimeRecords, options);
        if (transcript?.session.sessionId === sessionId) {
            return transcript;
        }
    }
    return null;
};

const deleteRuntimeRows = (db: Database, tableName: string, where: string, values: string[]): number => {
    if (!hasRuntimeTable(db, tableName)) {
        return 0;
    }
    return db.query(`DELETE FROM ${tableName} WHERE ${where}`).run(...values).changes;
};

const assertSessionIsUnlocked = (db: Database, sessionId: string) => {
    if (
        hasRuntimeTable(db, 'local_runtime_session_locks') &&
        db
            .query('SELECT 1 FROM local_runtime_session_locks WHERE session_id = ? AND expires_at_ms > ? LIMIT 1')
            .get(sessionId, Date.now())
    ) {
        throw new Error(`MiniMax Code session is currently locked: ${sessionId}`);
    }
};

const deleteMiniMaxCodeRuntimeRows = async (runtimeDbPath: string, sessionId: string): Promise<number> => {
    if (!(await Bun.file(runtimeDbPath).exists())) {
        return 0;
    }

    const db = new Database(runtimeDbPath, { create: false, readwrite: true, strict: true });
    try {
        db.run('PRAGMA busy_timeout = 5000');
        return runWithSqliteRetry({
            action: () =>
                db.transaction(() => {
                    assertSessionIsUnlocked(db, sessionId);
                    let deletedRowCount = 0;
                    deletedRowCount += deleteRuntimeRows(
                        db,
                        'local_runtime_background_task_events',
                        'owner_session_id = ?',
                        [sessionId],
                    );
                    deletedRowCount += deleteRuntimeRows(db, 'local_runtime_background_tasks', 'owner_session_id = ?', [
                        sessionId,
                    ]);
                    deletedRowCount += deleteRuntimeRows(
                        db,
                        'local_runtime_communication_messages',
                        'from_session = ? OR to_session = ?',
                        [sessionId, sessionId],
                    );
                    for (const tableName of SIMPLE_RUNTIME_SESSION_TABLES) {
                        deletedRowCount += deleteRuntimeRows(db, tableName, 'session_id = ?', [sessionId]);
                    }
                    deletedRowCount += deleteRuntimeRows(
                        db,
                        'local_runtime_legacy_migrations',
                        'local_session_id = ? OR legacy_session_id = ? OR legacy_daemon_session_id = ? OR legacy_framework_session_id = ?',
                        [sessionId, sessionId, sessionId, sessionId],
                    );
                    deletedRowCount += deleteRuntimeRows(db, 'local_runtime_sessions', 'session_id = ?', [sessionId]);
                    return deletedRowCount;
                })(),
        });
    } finally {
        db.close();
    }
};

const isSessionDirectoryInsideRoot = (sessionsDir: string, sessionDir: string): boolean => {
    const relative = path.relative(path.resolve(sessionsDir), path.resolve(sessionDir));
    return (
        relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
    );
};

type StagedMiniMaxCodeSession = {
    deletedFiles: string[];
    sessionDir: string;
    stagedSessionDir: string;
    stagingRoot: string;
};

const stageMiniMaxCodeSession = async (
    sessionsDir: string,
    sessionDir: string | null,
    sessionId: string,
): Promise<StagedMiniMaxCodeSession | null> => {
    if (!sessionDir) {
        return null;
    }
    if (!isSessionDirectoryInsideRoot(sessionsDir, sessionDir)) {
        throw new Error(`Refusing to delete MiniMax Code session outside the sessions directory: ${sessionId}`);
    }

    const stagingRoot = path.join(path.dirname(sessionsDir), '.spiracha-minimax-code-trash');
    const stagedSessionDir = path.join(stagingRoot, `${sessionId}-${randomUUID()}`);
    const deletedFiles = await listFilesRecursively(sessionDir);
    await mkdir(stagingRoot, { recursive: true });
    await rename(sessionDir, stagedSessionDir);
    return { deletedFiles, sessionDir, stagedSessionDir, stagingRoot };
};

const restoreStagedSession = async (staged: StagedMiniMaxCodeSession, cause: unknown) => {
    try {
        await rename(staged.stagedSessionDir, staged.sessionDir);
    } catch (restoreError) {
        throw new AggregateError(
            [cause, restoreError],
            `MiniMax Code deletion failed and the staged session could not be restored: ${staged.sessionDir}`,
        );
    }
    throw cause;
};

const removeStagedSession = async (staged: StagedMiniMaxCodeSession) => {
    await rm(staged.stagedSessionDir, { force: true, recursive: true });
    if ((await readDirectoryEntriesIfExists(staged.stagingRoot)).length === 0) {
        await rm(staged.stagingRoot, { force: true, recursive: true });
    }
};

const deleteMiniMaxCodeSessionWithLimit = async (
    sessionsDir: string,
    runtimeDbPath: string,
    sessionId: string,
): Promise<DeleteMiniMaxCodeSessionResult> => {
    if (!/^mvs_[A-Za-z0-9]+$/u.test(sessionId)) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const transcript = await readMiniMaxCodeSessionTranscript(sessionsDir, sessionId, { includeRawPayloads: false });
    const staged = await stageMiniMaxCodeSession(sessionsDir, transcript?.session.sessionDir ?? null, sessionId);

    let deletedRuntimeRows = 0;
    try {
        deletedRuntimeRows = await deleteMiniMaxCodeRuntimeRows(runtimeDbPath, sessionId);
    } catch (error) {
        if (staged) {
            await restoreStagedSession(staged, error);
        }
        throw error;
    }

    if (staged) {
        await removeStagedSession(staged);
    }

    return staged || deletedRuntimeRows > 0
        ? { deletedFiles: staged?.deletedFiles ?? [], deletedSessionIds: [sessionId] }
        : { deletedFiles: [], deletedSessionIds: [] };
};

export const deleteMiniMaxCodeSession = (
    sessionsDir: string,
    runtimeDbPath: string,
    sessionId: string,
): Promise<DeleteMiniMaxCodeSessionResult> => {
    return minimaxCodeDeleteLimiter(() => deleteMiniMaxCodeSessionWithLimit(sessionsDir, runtimeDbPath, sessionId));
};
