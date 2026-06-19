import { Database } from 'bun:sqlite';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { mapWithConcurrency } from './concurrency';
import { loadQoderAcpSession, type QoderAcpSessionUpdate, resolveQoderAcpSocketPath } from './qoder-acp-client';
import {
    getDefaultQoderUserDir,
    type QoderSessionSummary,
    type QoderSessionTranscript,
    type QoderTranscriptEntry,
    type QoderTranscriptPart,
    type QoderWorkspaceGroup,
    resolveQoderCliProjectsDir,
    resolveQoderGlobalStateDb,
    resolveQoderWorkspaceStorageDir,
} from './qoder-exporter-types';
import {
    asObject,
    asString,
    cleanExtractedText,
    cleanInlineTitle,
    getPortablePathBasename,
    isWorkspacePathQuery,
    type JsonValue,
    workspacePathMatchesQuery,
} from './shared';

export {
    getDefaultQoderUserDir,
    resolveQoderCliProjectsDir,
    resolveQoderGlobalStateDb,
    resolveQoderWorkspaceStorageDir,
};

const READ_CONCURRENCY = 8;
const WORKSPACE_KEY_PREFIX = 'workspace:';
const LOCAL_HISTORY_KEY_PATTERN = /^lingma\.chat\.localHistory\.(.+)\.quest$/u;
const MODEL_CONFIG_KEYS = ['aicoding.modelConfigs.cache.assistant', 'aicoding.modelConfigs.cache.quest'] as const;
const ACP_RECENT_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const QODER_MODEL_LABELS: Record<string, string> = {
    dfmodel: 'DeepSeek V4 Flash',
    dmodel: 'DeepSeek V4 Pro',
    gm51model: 'GLM 5.2',
    gmodel: 'GLM 5',
    kmodel: 'Kimi K2.7 Code',
    mmodel: 'MiniMax M3',
    q35model: 'Qwen 3.5 Plus',
    q35model_preview: 'Qwen 3.7 Max DogFooding',
    qmodel: 'Qwen 3.7 Plus',
    qmodel_latest: 'Qwen 3.7 Max',
};

type ItemTableRow = {
    key: string;
    value: string;
};

type QoderHistoryEntry = {
    historyKey: string;
    id: string;
    raw: Record<string, JsonValue>;
    sessionId: string;
    timestampMs: number | null;
    text: string;
    title: string;
    workspaceStorageId: string;
};

type QoderTaskEntry = {
    agentClass: string | null;
    createdAtMs: number | null;
    executionMode: string | null;
    executionRequestId: string | null;
    id: string;
    model: string | null;
    query: string | null;
    raw: Record<string, JsonValue>;
    sessionIds: string[];
    status: string | null;
    title: string | null;
    updatedAtMs: number | null;
    workspacePath: string;
};

type QoderSessionRecord = {
    histories: QoderHistoryEntry[];
    sessionId: string;
    task: QoderTaskEntry | null;
    worktree: string;
    workspaceStorageId: string | null;
};

type QoderStateData = {
    fileOperationCount: number;
    lastActiveAtMs: number | null;
    rawState: Record<string, JsonValue> | null;
    requestId: string | null;
    snapshotFileCount: number;
    statePath: string | null;
};

type SessionStats = {
    assistantMessageCount: number;
    fileOperationCount: number;
    messageCount: number;
    renderablePartCount: number;
    snapshotFileCount: number;
    userMessageCount: number;
};

type QoderModelConfigState = {
    assistantDefaultModel: string | null;
    questDefaultModel: string | null;
};

type QoderDataRecords = {
    modelConfig: QoderModelConfigState;
    records: QoderSessionRecord[];
    workspaceStorageIds: string[];
};

type QoderTranscriptReadOptions = {
    acpDrainMs?: number;
    acpSocketPath?: string | null;
    acpTimeoutMs?: number;
    enableAcp?: boolean;
};

const pathExists = async (target: string): Promise<boolean> => {
    return await stat(target)
        .then(() => true)
        .catch(() => false);
};

const toIso = (value: number | null): string | null => {
    return value === null ? null : new Date(value).toISOString();
};

const parseTimestampMs = (value: JsonValue | undefined): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        // Qoder stores some task timestamps in Unix seconds and others in epoch milliseconds.
        return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    }

    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            // Match the numeric branch so seconds-like string values sort correctly.
            return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
        }

        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

const cleanLabel = (value: string | null | undefined): string | null => {
    const cleaned = value?.replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned : null;
};

const normalizePromptText = (value: string | null | undefined): string | null => {
    const cleaned = value
        ?.replace(/\r\n?/gu, '\n')
        .replace(/\\r\\n|\\n/gu, '\n')
        .trimEnd();
    return cleaned ? cleaned : null;
};

const getWorkspaceKey = (worktree: string): string => {
    return `${WORKSPACE_KEY_PREFIX}${Buffer.from(worktree, 'utf8').toString('base64url')}`;
};

const warnQoder = (event: string, details: Record<string, JsonValue>) => {
    console.warn(`[spiracha:qoder] ${event}`, details);
};

const getWorktreeFromWorkspaceKey = (workspaceKey: string): string | null => {
    if (!workspaceKey.startsWith(WORKSPACE_KEY_PREFIX)) {
        warnQoder('invalid_workspace_key', { workspaceKey });
        return null;
    }

    try {
        const decoded = Buffer.from(workspaceKey.slice(WORKSPACE_KEY_PREFIX.length), 'base64url').toString('utf8');
        if (!decoded || decoded.includes('\uFFFD')) {
            warnQoder('invalid_workspace_key', { workspaceKey });
            return null;
        }

        return decoded;
    } catch {
        warnQoder('invalid_workspace_key', { workspaceKey });
        return null;
    }
};

const getWorkspaceLabel = (worktree: string): string => {
    return getPortablePathBasename(worktree) || worktree;
};

const getWorkspaceUri = (worktree: string): string => {
    return worktree.startsWith(path.sep) ? `file://${worktree}` : worktree;
};

const parseJsonValue = (value: string): JsonValue | null => {
    try {
        return JSON.parse(value) as JsonValue;
    } catch {
        return null;
    }
};

const readGlobalRows = async (globalStateDb = resolveQoderGlobalStateDb()): Promise<ItemTableRow[]> => {
    if (!(await pathExists(globalStateDb))) {
        return [];
    }

    let db: Database | null = null;
    try {
        db = new Database(globalStateDb, { readonly: true, strict: true });
        return db
            .query(
                "select key, value from ItemTable where key like 'lingma.chat.localHistory.%.quest' or key = 'aicoding.questTaskListSnapshot' or key in ('aicoding.modelConfigs.cache.assistant', 'aicoding.modelConfigs.cache.quest')",
            )
            .all() as ItemTableRow[];
    } catch {
        return [];
    } finally {
        db?.close();
    }
};

const asJsonObject = (value: JsonValue | null): Record<string, JsonValue> | null => {
    return value === null ? null : asObject(value);
};

const parseHistoryRows = (rows: ItemTableRow[]): QoderHistoryEntry[] => {
    const histories: QoderHistoryEntry[] = [];

    for (const row of rows) {
        const match = LOCAL_HISTORY_KEY_PATTERN.exec(row.key);
        if (!match) {
            continue;
        }

        const workspaceStorageId = match[1] ?? '';
        const value = parseJsonValue(row.value);
        const items = Array.isArray(value) ? value : [];

        items.forEach((item, index) => {
            const raw = asJsonObject(item);
            const sessionId = asString(raw?.sessionId ?? null);
            if (!raw || !sessionId) {
                return;
            }

            const id = asString(raw.id ?? null) ?? `${workspaceStorageId}:${index}`;
            const rawTitle = asString(raw.title ?? null);
            const title = cleanLabel(rawTitle) ?? sessionId;
            histories.push({
                historyKey: row.key,
                id,
                raw,
                sessionId,
                text: normalizePromptText(rawTitle) ?? title,
                timestampMs: parseTimestampMs(raw.timestamp),
                title,
                workspaceStorageId,
            });
        });
    }

    return histories;
};

const decodeFileUri = (value: string): string | null => {
    if (!value.startsWith('file://')) {
        return null;
    }

    try {
        return decodeURIComponent(new URL(value).pathname);
    } catch {
        return null;
    }
};

const getStringValue = (raw: Record<string, JsonValue>, keys: string[]): string | null => {
    for (const key of keys) {
        const value = cleanLabel(asString(raw[key] ?? null));
        if (value) {
            return value;
        }
    }

    return null;
};

const parseJsonObjectString = (value: JsonValue | undefined): Record<string, JsonValue> | null => {
    const text = asString(value ?? null);
    return text ? asJsonObject(parseJsonValue(text)) : null;
};

const normalizeQoderModelLabel = (value: string | null): string | null => {
    return value ? (QODER_MODEL_LABELS[value] ?? value) : null;
};

const getTaskModel = (raw: Record<string, JsonValue>): string | null => {
    const directModel = getStringValue(raw, [
        'model',
        'modelLabel',
        'modelName',
        'modelId',
        'modelVersion',
        'selectedModel',
    ]);
    if (directModel) {
        return normalizeQoderModelLabel(directModel);
    }

    const executionSessionExtra = parseJsonObjectString(raw.executionSessionExtra);
    const questTaskInfo = asObject(executionSessionExtra?.questTaskInfo ?? null);
    const executionConfig = asObject(questTaskInfo?.executionConfig ?? null);
    return normalizeQoderModelLabel(
        getStringValue(questTaskInfo ?? {}, ['model', 'modelLabel', 'modelName', 'modelId', 'selectedModel']) ??
            getStringValue(executionConfig ?? {}, ['model', 'modelLabel', 'modelName', 'modelId', 'selectedModel']),
    );
};

const getTimestampValue = (raw: Record<string, JsonValue>, keys: string[]): number | null => {
    for (const key of keys) {
        const value = parseTimestampMs(raw[key]);
        if (value !== null) {
            return value;
        }
    }

    return null;
};

const getWorkspacePathFromTask = (folder: string, task: Record<string, JsonValue>): string => {
    const workspaceUri = asString(task.workspaceUri ?? null);
    const decodedUri = workspaceUri ? decodeFileUri(workspaceUri) : null;
    return decodedUri ?? folder;
};

const getTaskSessionIds = (raw: Record<string, JsonValue>, id: string): string[] => {
    const executionSessionId = asString(raw.executionSessionId ?? null);
    const designSessionId = asString(raw.designSessionId ?? null);
    return [
        ...new Set([executionSessionId, `${id}.session.execution`, designSessionId, id].filter(Boolean)),
    ] as string[];
};

const parseTaskItem = (folder: string, item: JsonValue): QoderTaskEntry | null => {
    const raw = asJsonObject(item);
    const id = asString(raw?.id ?? null);
    if (!raw || !id) {
        return null;
    }

    return {
        agentClass: getStringValue(raw, ['agentClass']),
        createdAtMs: getTimestampValue(raw, ['createdAt', 'createTime']),
        executionMode: getStringValue(raw, ['executionMode', 'questType']),
        executionRequestId: getStringValue(raw, ['executionRequestId', 'designRequestId']),
        id,
        model: getTaskModel(raw),
        query: getStringValue(raw, ['query', 'userRequirements']),
        raw,
        sessionIds: getTaskSessionIds(raw, id),
        status: getStringValue(raw, ['status', 'bootStatus', 'prevStatus']),
        title: getStringValue(raw, ['title', 'name', 'query']),
        updatedAtMs: getTimestampValue(raw, [
            'updatedAtTimestamp',
            'executeEndAt',
            'executeEndTime',
            'finishedAt',
            'endTime',
            'lastUserQueryAt',
            'createdAt',
            'createTime',
        ]),
        workspacePath: getWorkspacePathFromTask(folder, raw),
    };
};

const parseFolderTasks = (folder: string, value: JsonValue): QoderTaskEntry[] => {
    const folderEntry = asObject(value);
    const folderTasks = Array.isArray(folderEntry?.tasks) ? folderEntry.tasks : [];
    return folderTasks.flatMap((item) => {
        const task = parseTaskItem(folder, item);
        return task ? [task] : [];
    });
};

const parseTaskSnapshotRows = (rows: ItemTableRow[]): QoderTaskEntry[] => {
    const snapshotRow = rows.find((row) => row.key === 'aicoding.questTaskListSnapshot');
    const snapshot = asJsonObject(snapshotRow ? parseJsonValue(snapshotRow.value) : null);
    const folders = asObject(snapshot?.folders ?? null);
    if (!folders) {
        return [];
    }

    return Object.entries(folders).flatMap(([folder, value]) => parseFolderTasks(folder, value));
};

const getConfiguredModelName = (value: JsonValue): string | null => {
    const config = asObject(value);
    return getStringValue(config ?? {}, ['key', 'name', 'model', 'modelId']);
};

const parseDefaultModelConfig = (rows: ItemTableRow[], key: (typeof MODEL_CONFIG_KEYS)[number]): string | null => {
    const row = rows.find((item) => item.key === key);
    const configs = row ? parseJsonValue(row.value) : null;
    if (!Array.isArray(configs)) {
        return null;
    }

    const selected =
        configs.find((item) => {
            const config = asObject(item);
            return config?.selected === true;
        }) ??
        configs.find((item) => {
            const config = asObject(item);
            return config?.enabled === true && config?.isDefault === true;
        }) ??
        configs.find((item) => {
            const config = asObject(item);
            return config?.isDefault === true;
        });

    return normalizeQoderModelLabel(getConfiguredModelName(selected ?? null));
};

const parseModelConfigState = (rows: ItemTableRow[]): QoderModelConfigState => ({
    assistantDefaultModel: parseDefaultModelConfig(rows, 'aicoding.modelConfigs.cache.assistant'),
    questDefaultModel: parseDefaultModelConfig(rows, 'aicoding.modelConfigs.cache.quest'),
});

const getModelFallback = (modelConfig: QoderModelConfigState): string | null => {
    return modelConfig.questDefaultModel ?? modelConfig.assistantDefaultModel;
};

const stripTrailingPathPunctuation = (value: string): string => {
    return value.replace(/[),.;\]]+$/u, '');
};

const inferWorkspaceFromAbsolutePath = (value: string): string | null => {
    const normalized = stripTrailingPathPunctuation(value);
    const marker = `${path.sep}workspace${path.sep}`;
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) {
        const prefixEnd = markerIndex + marker.length;
        const nextSeparator = normalized.indexOf(path.sep, prefixEnd);
        return nextSeparator >= 0 ? normalized.slice(0, nextSeparator) : normalized;
    }

    return path.dirname(normalized);
};

const inferWorkspaceFromText = (value: string | null): string | null => {
    if (!value) {
        return null;
    }

    const matches = value.match(/\/[^\s"'`)\]]+/gu) ?? [];
    for (const match of matches) {
        const workspace = inferWorkspaceFromAbsolutePath(match);
        if (workspace) {
            return workspace;
        }
    }

    return null;
};

const findTaskForSession = (
    tasksBySessionId: Map<string, QoderTaskEntry>,
    sessionId: string,
): QoderTaskEntry | null => {
    if (tasksBySessionId.has(sessionId)) {
        return tasksBySessionId.get(sessionId) ?? null;
    }

    if (sessionId.endsWith('.session.execution')) {
        return tasksBySessionId.get(sessionId.replace(/\.session\.execution$/u, '')) ?? null;
    }

    return tasksBySessionId.get(`${sessionId}.session.execution`) ?? null;
};

const buildTasksBySessionId = (tasks: QoderTaskEntry[]): Map<string, QoderTaskEntry> => {
    const tasksBySessionId = new Map<string, QoderTaskEntry>();
    for (const task of tasks) {
        for (const sessionId of task.sessionIds) {
            tasksBySessionId.set(sessionId, task);
        }
    }
    return tasksBySessionId;
};

const groupHistoriesBySessionId = (histories: QoderHistoryEntry[]): Map<string, QoderHistoryEntry[]> => {
    const historiesBySessionId = new Map<string, QoderHistoryEntry[]>();
    for (const history of histories) {
        const sessionHistories = historiesBySessionId.get(history.sessionId) ?? [];
        sessionHistories.push(history);
        historiesBySessionId.set(history.sessionId, sessionHistories);
    }
    return historiesBySessionId;
};

const sortHistories = (histories: QoderHistoryEntry[]): QoderHistoryEntry[] => {
    return [...histories].sort(
        (left, right) => (left.timestampMs ?? 0) - (right.timestampMs ?? 0) || left.id.localeCompare(right.id),
    );
};

const createRecordFromHistories = (
    sessionId: string,
    sessionHistories: QoderHistoryEntry[],
    task: QoderTaskEntry | null,
): QoderSessionRecord => {
    const histories = sortHistories(sessionHistories);
    const inferredWorktree =
        task?.workspacePath ?? inferWorkspaceFromText(histories.map((history) => history.text).join('\n'));
    const workspaceStorageId = histories[0]?.workspaceStorageId ?? null;

    return {
        histories,
        sessionId,
        task,
        workspaceStorageId,
        worktree: inferredWorktree ?? `Qoder workspace ${workspaceStorageId ?? 'unknown'}`,
    };
};

const createTaskOnlyRecords = (tasks: QoderTaskEntry[], usedTaskIds: Set<string>): QoderSessionRecord[] => {
    return tasks.flatMap((task) => {
        if (usedTaskIds.has(task.id)) {
            return [];
        }

        return [
            {
                histories: [],
                sessionId: task.sessionIds[0] ?? task.id,
                task,
                workspaceStorageId: null,
                worktree: task.workspacePath,
            },
        ];
    });
};

const groupRecords = (histories: QoderHistoryEntry[], tasks: QoderTaskEntry[]): QoderSessionRecord[] => {
    const tasksBySessionId = buildTasksBySessionId(tasks);
    const usedTaskIds = new Set<string>();
    const records = [...groupHistoriesBySessionId(histories).entries()].map(([sessionId, sessionHistories]) => {
        const task = findTaskForSession(tasksBySessionId, sessionId);
        if (task) {
            usedTaskIds.add(task.id);
        }

        return createRecordFromHistories(sessionId, sessionHistories, task);
    });

    return [...records, ...createTaskOnlyRecords(tasks, usedTaskIds)];
};

const listWorkspaceStorageIds = async (workspaceStorageDir: string): Promise<string[]> => {
    const entries = await readdir(workspaceStorageDir, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
};

const getStateDirectoryCandidates = (sessionId: string): string[] => {
    const candidates = [sessionId];
    if (sessionId.endsWith('.session.execution')) {
        candidates.push(sessionId.replace(/\.session\.execution$/u, ''));
    } else {
        candidates.push(`${sessionId}.session.execution`);
    }

    return [...new Set(candidates)];
};

const locateStatePath = async (
    workspaceStorageDir: string,
    workspaceStorageIds: string[],
    record: QoderSessionRecord,
): Promise<{ statePath: string | null; workspaceStorageId: string | null }> => {
    const storageIds = record.workspaceStorageId
        ? [record.workspaceStorageId, ...workspaceStorageIds.filter((id) => id !== record.workspaceStorageId)]
        : workspaceStorageIds;

    for (const workspaceStorageId of storageIds) {
        for (const directoryName of getStateDirectoryCandidates(record.sessionId)) {
            const statePath = path.join(
                workspaceStorageDir,
                workspaceStorageId,
                'chatEditingSessions',
                directoryName,
                'state.json',
            );
            if (await pathExists(statePath)) {
                return { statePath, workspaceStorageId };
            }
        }
    }

    return { statePath: null, workspaceStorageId: record.workspaceStorageId };
};

const readJsonObject = async (filePath: string): Promise<Record<string, JsonValue> | null> => {
    const value = (await Bun.file(filePath)
        .json()
        .catch(() => null)) as JsonValue | null;
    return asJsonObject(value);
};

const readStateData = async (
    workspaceStorageDir: string,
    workspaceStorageIds: string[],
    record: QoderSessionRecord,
): Promise<QoderStateData> => {
    const located = await locateStatePath(workspaceStorageDir, workspaceStorageIds, record);
    if (!located.statePath) {
        return {
            fileOperationCount: 0,
            lastActiveAtMs: null,
            rawState: null,
            requestId: null,
            snapshotFileCount: 0,
            statePath: null,
        };
    }

    const rawState = await readJsonObject(located.statePath);
    const stateStats = await stat(located.statePath)
        .then((stats) => ({ mtimeMs: stats.mtimeMs }))
        .catch(() => null);
    const timeline = asObject(rawState?.timeline ?? null);
    const operations = Array.isArray(timeline?.operations) ? timeline.operations : [];
    const recentSnapshot = asObject(rawState?.recentSnapshot ?? null);
    const snapshots = Array.isArray(recentSnapshot?.entries) ? recentSnapshot.entries : [];
    const requestId =
        operations
            .map((operation) => asString(asObject(operation)?.requestId ?? null))
            .find((value): value is string => Boolean(value)) ??
        snapshots
            .map((snapshot) => asString(asObject(asObject(snapshot)?.telemetryInfo ?? null)?.requestId ?? null))
            .find((value): value is string => Boolean(value)) ??
        null;

    return {
        fileOperationCount: operations.length,
        lastActiveAtMs: stateStats?.mtimeMs ?? null,
        rawState,
        requestId,
        snapshotFileCount: snapshots.length,
        statePath: located.statePath,
    };
};

const createEmptyStats = (): SessionStats => ({
    assistantMessageCount: 0,
    fileOperationCount: 0,
    messageCount: 0,
    renderablePartCount: 0,
    snapshotFileCount: 0,
    userMessageCount: 0,
});

const isRenderablePart = (part: QoderTranscriptPart): boolean => {
    return part.type === 'text' && Boolean(part.text?.trim());
};

const updateStatsFromEntry = (stats: SessionStats, entry: QoderTranscriptEntry) => {
    if (entry.entryType === 'tool_call') {
        stats.fileOperationCount += 1;
    }

    if (entry.role === 'assistant' || entry.role === 'user') {
        stats.messageCount += 1;
    }

    if (entry.role === 'assistant') {
        stats.assistantMessageCount += 1;
    }

    if (entry.role === 'user') {
        stats.userMessageCount += 1;
    }

    stats.renderablePartCount += entry.parts.filter(isRenderablePart).length;
};

const createStatsFromEntries = (entries: QoderTranscriptEntry[], snapshotFileCount: number): SessionStats => {
    const stats = createEmptyStats();
    stats.snapshotFileCount = snapshotFileCount;
    for (const entry of entries) {
        updateStatsFromEntry(stats, entry);
    }
    return stats;
};

const getRecordTitle = (record: QoderSessionRecord): string => {
    return cleanInlineTitle(record.task?.title ?? record.histories[0]?.title ?? record.sessionId);
};

const maxNullable = (...values: (number | null)[]): number | null => {
    return values.reduce<number | null>((latest, value) => {
        if (value === null) {
            return latest;
        }

        return latest === null ? value : Math.max(latest, value);
    }, null);
};

const getCreatedAtMs = (record: QoderSessionRecord): number | null => {
    const historyCreatedAt = record.histories.reduce<number | null>((earliest, history) => {
        if (history.timestampMs === null) {
            return earliest;
        }

        return earliest === null ? history.timestampMs : Math.min(earliest, history.timestampMs);
    }, null);
    return record.task?.createdAtMs ?? historyCreatedAt;
};

const getLastActiveAtMs = (record: QoderSessionRecord, state: QoderStateData): number | null => {
    const latestHistoryAt = record.histories.reduce<number | null>((latest, history) => {
        return maxNullable(latest, history.timestampMs);
    }, null);
    return maxNullable(record.task?.updatedAtMs ?? null, latestHistoryAt, state.lastActiveAtMs);
};

const toSessionSummary = (
    record: QoderSessionRecord,
    state: QoderStateData,
    stats: SessionStats,
    modelFallback: string | null = null,
): QoderSessionSummary => {
    const createdAtMs = getCreatedAtMs(record);
    const lastActiveAtMs = getLastActiveAtMs(record, state);
    const workspaceLabel = getWorkspaceLabel(record.worktree);

    return {
        ...stats,
        agentClass: record.task?.agentClass ?? null,
        createdAtIso: toIso(createdAtMs),
        createdAtMs,
        executionMode: record.task?.executionMode ?? null,
        historyIds: record.histories.map((history) => history.id),
        lastActiveAtIso: toIso(lastActiveAtMs),
        lastActiveAtMs,
        model: record.task?.model ?? modelFallback,
        query: record.task?.query ?? record.histories[0]?.title ?? null,
        requestId: state.requestId ?? record.task?.executionRequestId ?? null,
        sessionId: record.sessionId,
        sourceStatePath: state.statePath,
        status: record.task?.status ?? null,
        taskId: record.task?.id ?? null,
        title: getRecordTitle(record),
        workspaceKey: getWorkspaceKey(record.worktree),
        workspaceLabel,
        workspacePath: record.worktree.startsWith(path.sep) ? record.worktree : null,
        workspaceStorageId: record.workspaceStorageId,
        worktree: record.worktree,
    };
};

const loadRecords = async (
    globalStateDb = resolveQoderGlobalStateDb(),
    workspaceStorageDir = resolveQoderWorkspaceStorageDir(),
): Promise<QoderDataRecords> => {
    const [rows, workspaceStorageIds] = await Promise.all([
        readGlobalRows(globalStateDb),
        listWorkspaceStorageIds(workspaceStorageDir),
    ]);
    return {
        modelConfig: parseModelConfigState(rows),
        records: groupRecords(parseHistoryRows(rows), parseTaskSnapshotRows(rows)),
        workspaceStorageIds,
    };
};

const readRecordSummary = async (
    record: QoderSessionRecord,
    workspaceStorageDir: string,
    workspaceStorageIds: string[],
    modelFallback: string | null,
): Promise<QoderSessionSummary> => {
    const state = await readStateData(workspaceStorageDir, workspaceStorageIds, record);
    const entries = buildLocalTranscriptEntries(record, state);
    const stats = createStatsFromEntries(entries, state.snapshotFileCount);
    return toSessionSummary(record, state, stats, modelFallback);
};

const compareNullableMsDesc = (left: number | null, right: number | null): number => {
    return (right ?? 0) - (left ?? 0);
};

const sumSessions = (sessions: QoderSessionSummary[], key: keyof SessionStats): number => {
    return sessions.reduce((total, session) => total + session[key], 0);
};

const toWorkspaceGroup = (worktree: string, sessions: QoderSessionSummary[]): QoderWorkspaceGroup => {
    const lastActiveAtMs = sessions.reduce<number | null>((latest, session) => {
        return maxNullable(latest, session.lastActiveAtMs);
    }, null);

    return {
        assistantMessageCount: sumSessions(sessions, 'assistantMessageCount'),
        fileOperationCount: sumSessions(sessions, 'fileOperationCount'),
        key: getWorkspaceKey(worktree),
        label: getWorkspaceLabel(worktree),
        lastActiveAtIso: toIso(lastActiveAtMs),
        lastActiveAtMs,
        messageCount: sumSessions(sessions, 'messageCount'),
        renderablePartCount: sumSessions(sessions, 'renderablePartCount'),
        sessionCount: sessions.length,
        snapshotFileCount: sumSessions(sessions, 'snapshotFileCount'),
        uri: getWorkspaceUri(worktree),
        userMessageCount: sumSessions(sessions, 'userMessageCount'),
        workspaceStorageIds: [...new Set(sessions.flatMap((session) => session.workspaceStorageId ?? []))],
        worktree,
    };
};

export const listQoderWorkspaceGroups = async (
    globalStateDb = resolveQoderGlobalStateDb(),
    workspaceStorageDir = resolveQoderWorkspaceStorageDir(),
): Promise<QoderWorkspaceGroup[]> => {
    const { modelConfig, records, workspaceStorageIds } = await loadRecords(globalStateDb, workspaceStorageDir);
    const modelFallback = getModelFallback(modelConfig);
    const summaries = await mapWithConcurrency(records, READ_CONCURRENCY, (record) =>
        readRecordSummary(record, workspaceStorageDir, workspaceStorageIds, modelFallback),
    );
    const sessionsByWorktree = new Map<string, QoderSessionSummary[]>();

    for (const session of summaries) {
        const sessions = sessionsByWorktree.get(session.worktree) ?? [];
        sessions.push(session);
        sessionsByWorktree.set(session.worktree, sessions);
    }

    return [...sessionsByWorktree.entries()]
        .map(([worktree, sessions]) => toWorkspaceGroup(worktree, sessions))
        .sort(
            (left, right) =>
                compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) ||
                left.worktree.localeCompare(right.worktree),
        );
};

const qoderWorkspaceMatchesQuery = (workspace: QoderWorkspaceGroup, query: string): boolean => {
    const raw = query.trim();
    if (!raw) {
        return true;
    }

    const lowered = raw.toLowerCase();
    if (workspace.key.toLowerCase() === lowered || workspace.label.toLowerCase() === lowered) {
        return true;
    }

    if (isWorkspacePathQuery(raw)) {
        return workspacePathMatchesQuery(workspace.worktree, raw);
    }

    return getPortablePathBasename(workspace.worktree).toLowerCase() === lowered;
};

export const findQoderWorkspaceGroups = (groups: QoderWorkspaceGroup[], query: string): QoderWorkspaceGroup[] => {
    return groups.filter((group) => qoderWorkspaceMatchesQuery(group, query));
};

const sortSessions = (sessions: QoderSessionSummary[]): QoderSessionSummary[] => {
    return [...sessions].sort(
        (left, right) =>
            compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) || left.title.localeCompare(right.title),
    );
};

export const listQoderSessionsForGroup = async (
    workspaceKey: string,
    globalStateDb = resolveQoderGlobalStateDb(),
    workspaceStorageDir = resolveQoderWorkspaceStorageDir(),
): Promise<QoderSessionSummary[]> => {
    const worktree = getWorktreeFromWorkspaceKey(workspaceKey);
    if (!worktree) {
        return [];
    }

    const { modelConfig, records, workspaceStorageIds } = await loadRecords(globalStateDb, workspaceStorageDir);
    const matchingRecords = records.filter((record) => record.worktree === worktree);
    const modelFallback = getModelFallback(modelConfig);
    const summaries = await mapWithConcurrency(matchingRecords, READ_CONCURRENCY, (record) =>
        readRecordSummary(record, workspaceStorageDir, workspaceStorageIds, modelFallback),
    );
    return sortSessions(summaries);
};

const parseTextPart = (raw: Record<string, JsonValue>, text: string): QoderTranscriptPart => ({
    raw,
    text,
    type: 'text',
});

const buildHistoryEntry = (history: QoderHistoryEntry, index: number): QoderTranscriptEntry => ({
    entryId: history.id || `history:${index}`,
    entryType: 'message',
    parts: [
        parseTextPart(
            {
                historyKey: history.historyKey,
                id: history.id,
                source: 'qoderLocalHistory',
                title: history.title,
            },
            history.text,
        ),
    ],
    raw: history.raw,
    requestId: null,
    role: 'user',
    timestamp: toIso(history.timestampMs),
});

const getUriPath = (operation: Record<string, JsonValue>): string => {
    const uri = asObject(operation.uri ?? null);
    return (
        asString(uri?.fsPath ?? null) ??
        asString(uri?.path ?? null) ??
        asString(uri?.external ?? null) ??
        asString(operation.resource ?? null) ??
        'unknown file'
    );
};

const getEditPreview = (operation: Record<string, JsonValue>): string | null => {
    const edits = Array.isArray(operation.edits) ? operation.edits : [];
    const text = edits
        .map((edit) => asString(asObject(edit)?.text ?? null))
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n\n')
        .trim();
    if (!text) {
        return null;
    }

    const cleaned = cleanExtractedText(text);
    return cleaned.length > 1200 ? `${cleaned.slice(0, 1200).trimEnd()}\n...[truncated]` : cleaned;
};

const buildOperationCommand = (operation: Record<string, JsonValue>): { command: string; toolName: string } => {
    const type = asString(operation.type ?? null) ?? 'operation';
    const filePath = getUriPath(operation);

    if (type === 'create') {
        return { command: `Create file: ${filePath}`, toolName: 'create_file' };
    }

    if (type === 'delete') {
        return { command: `Delete file: ${filePath}`, toolName: 'delete_file' };
    }

    if (type === 'textEdit') {
        const edits = Array.isArray(operation.edits) ? operation.edits.length : 0;
        const preview = getEditPreview(operation);
        return {
            command: [`Edit file: ${filePath}`, `Edits: ${edits}`, preview ? `Preview:\n${preview}` : '']
                .filter(Boolean)
                .join('\n'),
            toolName: 'edit_file',
        };
    }

    return { command: `${cleanInlineTitle(type)}: ${filePath}`, toolName: type };
};

const buildOperationEntry = (
    operation: Record<string, JsonValue>,
    index: number,
    statePath: string | null,
): QoderTranscriptEntry => {
    const requestId = asString(operation.requestId ?? null);
    const operationId =
        asString(operation.operationId ?? null) ?? asString(operation.type ?? null) ?? `operation:${index}`;
    const summary = buildOperationCommand(operation);

    return {
        entryId: `${statePath ?? 'state'}:${operationId}:${index}`,
        entryType: 'tool_call',
        parts: [
            parseTextPart(
                {
                    command: summary.command,
                    operationIndex: index,
                    sourceStatePath: statePath,
                    toolName: summary.toolName,
                    type: 'qoderFileOperation',
                },
                summary.command,
            ),
        ],
        raw: operation,
        requestId,
        role: 'tool',
        timestamp: null,
    };
};

type QoderCliPart = {
    entryType: QoderTranscriptEntry['entryType'];
    raw: Record<string, JsonValue>;
    role: string;
    text: string;
};

type QoderCliTranscript = {
    entries: QoderTranscriptEntry[];
    model: string | null;
    path: string | null;
};

const getCliWorkspaceDirectoryName = (worktree: string): string => {
    return worktree.replace(/[\\/]+/gu, '-');
};

const getCliTranscriptCandidates = (projectsDir: string, record: QoderSessionRecord): string[] => {
    return [
        path.join(projectsDir, `${record.sessionId}.jsonl`),
        path.join(projectsDir, getCliWorkspaceDirectoryName(record.worktree), `${record.sessionId}.jsonl`),
    ];
};

const locateCliTranscriptPath = async (projectsDir: string, record: QoderSessionRecord): Promise<string | null> => {
    for (const candidate of getCliTranscriptCandidates(projectsDir, record)) {
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    return null;
};

const stringifyCliValue = (value: JsonValue | undefined): string | null => {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (value === null || value === undefined) {
        return null;
    }

    return JSON.stringify(value, null, 2);
};

const getCliTextValue = (value: JsonValue | undefined): string | null => {
    if (Array.isArray(value)) {
        const text = value
            .map((item) => getCliTextValue(item))
            .filter((item): item is string => Boolean(item?.trim()))
            .join('\n');
        return text ? text : null;
    }

    const objectValue = asObject(value ?? null);
    if (objectValue) {
        return (
            getCliTextValue(objectValue.text) ??
            getCliTextValue(objectValue.content) ??
            getCliTextValue(objectValue.result) ??
            stringifyCliValue(objectValue)
        );
    }

    return stringifyCliValue(value);
};

const getCliPartData = (part: Record<string, JsonValue>): Record<string, JsonValue> => {
    return asObject(part.data ?? null) ?? part;
};

const getCliToolName = (part: Record<string, JsonValue>, data: Record<string, JsonValue>): string => {
    return asString(data.name ?? null) ?? asString(part.name ?? null) ?? 'qoder_tool';
};

const formatCliToolCall = (part: Record<string, JsonValue>, data: Record<string, JsonValue>): string | null => {
    const name = getCliToolName(part, data);
    const input = getCliTextValue(data.input ?? part.input);
    const text = [name, input].filter((value): value is string => Boolean(value?.trim())).join('\n');
    return text || null;
};

const cliTextPartToTranscriptPart = (part: Record<string, JsonValue>, role: string): QoderCliPart | null => {
    const data = getCliPartData(part);
    const text = getCliTextValue(data.text ?? part.text);
    return text ? { entryType: 'message', raw: part, role, text } : null;
};

const cliReasoningPartToTranscriptPart = (part: Record<string, JsonValue>, type: string): QoderCliPart | null => {
    const data = getCliPartData(part);
    const text = getCliTextValue(data.thinking ?? data.signature ?? part.thinking ?? part.text);
    return text ? { entryType: 'message', raw: { ...part, sourceType: type }, role: 'assistant', text } : null;
};

const cliToolCallPartToTranscriptPart = (part: Record<string, JsonValue>): QoderCliPart | null => {
    const data = getCliPartData(part);
    const text = formatCliToolCall(part, data);
    return text
        ? {
              entryType: 'tool_call',
              raw: {
                  ...part,
                  command: text,
                  toolName: getCliToolName(part, data),
              },
              role: 'tool',
              text,
          }
        : null;
};

const cliToolOutputPartToTranscriptPart = (part: Record<string, JsonValue>): QoderCliPart | null => {
    const data = getCliPartData(part);
    const text = getCliTextValue(data.content ?? data.output ?? part.content);
    return text
        ? {
              entryType: 'tool_output',
              raw: {
                  ...part,
                  toolCallId: asString(data.tool_use_id ?? part.tool_use_id ?? null),
                  toolName: getCliToolName(part, data),
              },
              role: 'tool',
              text,
          }
        : null;
};

const cliPartToTranscriptPart = (part: Record<string, JsonValue>, role: string): QoderCliPart | null => {
    const type = asString(part.type ?? null);
    switch (type) {
        case 'text':
            return cliTextPartToTranscriptPart(part, role);
        case 'reasoning':
        case 'thinking':
            return cliReasoningPartToTranscriptPart(part, type);
        case 'tool_call':
        case 'tool_use':
            return cliToolCallPartToTranscriptPart(part);
        case 'tool_result':
        case 'tool_output':
            return cliToolOutputPartToTranscriptPart(part);
        default:
            return null;
    }
};

const getCliLineParts = (raw: Record<string, JsonValue>): Record<string, JsonValue>[] => {
    const parts = Array.isArray(raw.parts) ? raw.parts : asObject(raw.message ?? null)?.content;
    return Array.isArray(parts)
        ? parts.map((part) => asObject(part)).filter((part): part is Record<string, JsonValue> => Boolean(part))
        : [];
};

const getCliLineRole = (raw: Record<string, JsonValue>): string => {
    return (
        asString(raw.role ?? null) ??
        asString(asObject(raw.message ?? null)?.role ?? null) ??
        asString(raw.type ?? null) ??
        'unknown'
    );
};

const normalizeCliModel = (model: string | null, modelFallback: string | null): string | null => {
    if (!model) {
        return null;
    }

    if (model === 'auto') {
        return modelFallback;
    }

    return normalizeQoderModelLabel(model);
};

const parseCliTranscriptLine = (
    raw: Record<string, JsonValue>,
    lineIndex: number,
    sourcePath: string,
): QoderTranscriptEntry[] => {
    const role = getCliLineRole(raw);
    const timestamp = toIso(parseTimestampMs(raw.created_at ?? raw.timestamp ?? raw.updated_at));
    const parentId = asString(raw.id ?? raw.uuid ?? null) ?? `${sourcePath}:${lineIndex}`;
    return getCliLineParts(raw).flatMap((part, partIndex) => {
        const parsed = cliPartToTranscriptPart(part, role);
        if (!parsed) {
            return [];
        }

        return [
            {
                entryId: `${parentId}:${partIndex}`,
                entryType: parsed.entryType,
                parts: [
                    parseTextPart(
                        {
                            ...parsed.raw,
                            source: 'qoderCliTranscript',
                            sourcePath,
                        },
                        parsed.text,
                    ),
                ],
                raw,
                requestId: asString(raw.request_set_id ?? raw.requestSetId ?? null),
                role: parsed.role,
                timestamp,
            },
        ];
    });
};

const readCliTranscriptEntries = async (
    projectsDir: string,
    record: QoderSessionRecord,
    modelFallback: string | null,
): Promise<QoderCliTranscript> => {
    const transcriptPath = await locateCliTranscriptPath(projectsDir, record);
    if (!transcriptPath) {
        return { entries: [], model: null, path: null };
    }

    const text = await Bun.file(transcriptPath)
        .text()
        .catch(() => '');
    let model: string | null = null;
    const entries = text.split(/\r?\n/u).flatMap((line, lineIndex) => {
        if (!line.trim()) {
            return [];
        }

        const raw = asJsonObject(parseJsonValue(line));
        model ??= normalizeCliModel(asString(raw?.model ?? null), modelFallback);
        return raw ? parseCliTranscriptLine(raw, lineIndex, transcriptPath) : [];
    });

    return { entries, model, path: transcriptPath };
};

const getRawStringValue = (raw: Record<string, JsonValue>, keys: string[]): string | null => {
    for (const key of keys) {
        const value = asString(raw[key] ?? null);
        if (value?.trim()) {
            return value;
        }
    }

    return null;
};

const stringifyAcpValue = (value: JsonValue | undefined): string | null => {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (value === null || value === undefined) {
        return null;
    }

    return JSON.stringify(value, null, 2);
};

const getAcpContentText = (update: Record<string, JsonValue>): string | null => {
    const content = asObject(update.content ?? null);
    const data = asObject(update.data ?? null);
    return (
        getRawStringValue(content ?? {}, ['text', 'content', 'thinking']) ??
        getRawStringValue(data ?? {}, ['text', 'content', 'thinking', 'output']) ??
        getRawStringValue(update, ['text', 'content', 'thinking', 'message', 'delta'])
    );
};

const getAcpTimestamp = (update: Record<string, JsonValue>): string | null => {
    return toIso(parseTimestampMs(update.timestamp ?? update.created_at ?? update.createdAt ?? update.updated_at));
};

const buildAcpMessageEntry = (
    event: QoderAcpSessionUpdate,
    index: number,
    role: 'assistant' | 'user',
): QoderTranscriptEntry | null => {
    const text = getAcpContentText(event.update);
    if (!text?.trim()) {
        return null;
    }

    return {
        entryId: `qoder-acp:${event.sessionId}:${index}`,
        entryType: 'message',
        parts: [
            parseTextPart(
                {
                    requestId: event.requestId,
                    sessionUpdate: event.update.sessionUpdate ?? null,
                    source: 'qoderAcpSessionLoad',
                },
                text,
            ),
        ],
        raw: event.update,
        requestId: event.requestId,
        role,
        timestamp: getAcpTimestamp(event.update),
    };
};

const getAcpToolId = (update: Record<string, JsonValue>, index: number): string => {
    return (
        getRawStringValue(update, ['toolCallId', 'tool_call_id', 'callId', 'id']) ??
        getRawStringValue(asObject(update.toolCall ?? null) ?? {}, ['id', 'toolCallId']) ??
        `tool:${index}`
    );
};

const getAcpToolName = (update: Record<string, JsonValue>): string => {
    return (
        getRawStringValue(update, ['toolName', 'name', 'title', 'kind']) ??
        getRawStringValue(asObject(update.toolCall ?? null) ?? {}, ['toolName', 'name', 'title', 'kind']) ??
        'qoder_tool'
    );
};

const buildAcpToolCallText = (update: Record<string, JsonValue>): string | null => {
    const toolCall = asObject(update.toolCall ?? null);
    const name = getAcpToolName(update);
    const input =
        stringifyAcpValue(update.input) ??
        stringifyAcpValue(update.arguments) ??
        stringifyAcpValue(update.rawInput) ??
        stringifyAcpValue(toolCall?.input) ??
        stringifyAcpValue(toolCall?.arguments);
    return [name, input].filter((value): value is string => Boolean(value?.trim())).join('\n') || null;
};

const buildAcpToolOutputText = (update: Record<string, JsonValue>): string | null => {
    const text =
        getAcpContentText(update) ??
        stringifyAcpValue(update.output) ??
        stringifyAcpValue(update.result) ??
        stringifyAcpValue(update.rawOutput);
    return text?.trim() ? text : null;
};

const buildAcpToolEntry = (
    event: QoderAcpSessionUpdate,
    index: number,
    entryType: 'tool_call' | 'tool_output',
): QoderTranscriptEntry | null => {
    const text = entryType === 'tool_call' ? buildAcpToolCallText(event.update) : buildAcpToolOutputText(event.update);
    if (!text) {
        return null;
    }

    const toolCallId = getAcpToolId(event.update, index);
    const toolName = getAcpToolName(event.update);
    return {
        entryId: `qoder-acp:${event.sessionId}:${toolCallId}:${index}`,
        entryType,
        parts: [
            parseTextPart(
                {
                    requestId: event.requestId,
                    sessionUpdate: event.update.sessionUpdate ?? null,
                    source: 'qoderAcpSessionLoad',
                    toolCallId,
                    toolName,
                },
                text,
            ),
        ],
        raw: event.update,
        requestId: event.requestId,
        role: 'tool',
        timestamp: getAcpTimestamp(event.update),
    };
};

const acpUpdateToEntry = (event: QoderAcpSessionUpdate, index: number): QoderTranscriptEntry | null => {
    switch (event.update.sessionUpdate) {
        case 'user_message_chunk':
            return buildAcpMessageEntry(event, index, 'user');
        case 'agent_thought_chunk':
        case 'agent_message_chunk':
            return buildAcpMessageEntry(event, index, 'assistant');
        case 'tool_call':
            return buildAcpToolEntry(event, index, 'tool_call');
        case 'tool_call_update':
            return buildAcpToolEntry(event, index, 'tool_output');
        default:
            return null;
    }
};

const getAcpModel = (events: QoderAcpSessionUpdate[]): string | null => {
    for (const event of [...events].reverse()) {
        if (event.update.sessionUpdate !== 'current_model_update') {
            continue;
        }

        const model = normalizeQoderModelLabel(getRawStringValue(event.update, ['modelId', 'model', 'modelName']));
        if (model) {
            return model;
        }
    }

    return null;
};

const getTaskIdForAcpLoad = (record: QoderSessionRecord): string | null => {
    return record.task?.id ?? (record.sessionId.replace(/\.session\.execution$/u, '') || null);
};

const shouldUseAcp = (
    record: QoderSessionRecord,
    state: QoderStateData,
    cliTranscript: QoderCliTranscript,
    options: QoderTranscriptReadOptions,
    globalStateDb: string,
    workspaceStorageDir: string,
): boolean => {
    if (options.enableAcp === false) {
        return false;
    }

    if (cliTranscript.entries.some((entry) => entry.role === 'assistant')) {
        return false;
    }

    if (options.acpSocketPath) {
        return true;
    }

    if (globalStateDb !== resolveQoderGlobalStateDb() || workspaceStorageDir !== resolveQoderWorkspaceStorageDir()) {
        return false;
    }

    const lastActiveAtMs = getLastActiveAtMs(record, state);
    return lastActiveAtMs !== null && Date.now() - lastActiveAtMs <= ACP_RECENT_SESSION_WINDOW_MS;
};

const readAcpTranscriptEntries = async (
    record: QoderSessionRecord,
    state: QoderStateData,
    cliTranscript: QoderCliTranscript,
    options: QoderTranscriptReadOptions,
    globalStateDb: string,
    workspaceStorageDir: string,
): Promise<{ entries: QoderTranscriptEntry[]; model: string | null; socketPath: string | null }> => {
    if (!shouldUseAcp(record, state, cliTranscript, options, globalStateDb, workspaceStorageDir)) {
        return { entries: [], model: null, socketPath: null };
    }

    const loaded = await loadQoderAcpSession({
        cwd: record.worktree,
        drainMs: options.acpDrainMs,
        sessionId: record.sessionId,
        socketPath: options.acpSocketPath ?? resolveQoderAcpSocketPath(),
        taskId: getTaskIdForAcpLoad(record),
        timeoutMs: options.acpTimeoutMs,
    });
    if (!loaded) {
        return { entries: [], model: null, socketPath: null };
    }

    return {
        entries: loaded.events
            .map((event, index) => acpUpdateToEntry(event, index))
            .filter((entry): entry is QoderTranscriptEntry => Boolean(entry)),
        model: getAcpModel(loaded.events),
        socketPath: loaded.socketPath,
    };
};

const buildLocalTranscriptEntryGroups = (
    record: QoderSessionRecord,
    state: QoderStateData,
): { historyEntries: QoderTranscriptEntry[]; operationEntries: QoderTranscriptEntry[] } => {
    const historyEntries = record.histories.map(buildHistoryEntry);
    const timeline = asObject(state.rawState?.timeline ?? null);
    const operations = Array.isArray(timeline?.operations) ? timeline.operations : [];
    const operationEntries = operations.flatMap((operation, index) => {
        const raw = asObject(operation);
        return raw ? [buildOperationEntry(raw, index, state.statePath)] : [];
    });
    return { historyEntries, operationEntries };
};

const buildLocalTranscriptEntries = (record: QoderSessionRecord, state: QoderStateData): QoderTranscriptEntry[] => {
    const { historyEntries, operationEntries } = buildLocalTranscriptEntryGroups(record, state);
    return [...historyEntries, ...operationEntries];
};

const buildTranscriptEntries = async (
    record: QoderSessionRecord,
    state: QoderStateData,
    cliProjectsDir: string,
    modelFallback: string | null,
    options: QoderTranscriptReadOptions,
    globalStateDb: string,
    workspaceStorageDir: string,
): Promise<{
    acpSocketPath: string | null;
    cliTranscriptPath: string | null;
    entries: QoderTranscriptEntry[];
    model: string | null;
}> => {
    const { historyEntries, operationEntries } = buildLocalTranscriptEntryGroups(record, state);
    const cliTranscript = await readCliTranscriptEntries(cliProjectsDir, record, modelFallback);
    const acpTranscript = await readAcpTranscriptEntries(
        record,
        state,
        cliTranscript,
        options,
        globalStateDb,
        workspaceStorageDir,
    );
    const transcriptEntries = cliTranscript.entries.some((entry) => entry.role === 'assistant')
        ? cliTranscript.entries
        : acpTranscript.entries;
    const shouldIncludeHistory = !transcriptEntries.some((entry) => entry.role === 'user');

    return {
        acpSocketPath: acpTranscript.socketPath,
        cliTranscriptPath: cliTranscript.path,
        entries: [...(shouldIncludeHistory ? historyEntries : []), ...transcriptEntries, ...operationEntries],
        model: acpTranscript.model ?? cliTranscript.model ?? modelFallback,
    };
};

export const readQoderSessionTranscript = async (
    globalStateDb: string,
    workspaceStorageDir: string,
    sessionId: string,
    cliProjectsDir = resolveQoderCliProjectsDir(),
    options: QoderTranscriptReadOptions = {},
): Promise<QoderSessionTranscript | null> => {
    const { modelConfig, records, workspaceStorageIds } = await loadRecords(globalStateDb, workspaceStorageDir);
    const record = records.find((candidate) => candidate.sessionId === sessionId);
    if (!record) {
        return null;
    }

    const state = await readStateData(workspaceStorageDir, workspaceStorageIds, record);
    const modelFallback = getModelFallback(modelConfig);
    const { acpSocketPath, cliTranscriptPath, entries, model } = await buildTranscriptEntries(
        record,
        state,
        cliProjectsDir,
        modelFallback,
        options,
        globalStateDb,
        workspaceStorageDir,
    );
    const stats = createStatsFromEntries(entries, state.snapshotFileCount);

    return {
        entries,
        rawSession: {
            histories: record.histories.map((history) => history.raw),
            sourceAcpSocketPath: acpSocketPath,
            sourceCliTranscriptPath: cliTranscriptPath,
            sourceStatePath: state.statePath,
            state: state.rawState,
            task: record.task?.raw ?? null,
            workspaceStorageId: record.workspaceStorageId,
        },
        renderablePartCount: stats.renderablePartCount,
        session: toSessionSummary(record, state, stats, model),
    };
};
