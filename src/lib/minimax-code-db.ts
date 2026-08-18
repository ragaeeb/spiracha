import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import type {
    DeleteMiniMaxCodeSessionResult,
    MiniMaxCodeSessionSummary,
    MiniMaxCodeSessionTranscript,
    MiniMaxCodeToolCall,
    MiniMaxCodeToolStatus,
    MiniMaxCodeTranscriptMessage,
    MiniMaxCodeWorkspaceGroup,
} from './minimax-code-exporter-types';
import {
    getDefaultMiniMaxCodeDataDir,
    resolveMiniMaxCodeDataDir,
    resolveMiniMaxCodeRuntimeDbPath,
    resolveMiniMaxCodeSessionsDir,
} from './minimax-code-exporter-types';
import { getPortablePathBasename } from './portable-path';
import {
    asBoolean,
    asNumber,
    asObject,
    asString,
    cleanInlineTitle,
    type JsonValue,
    readDirectoryEntriesIfExists,
    readJsonlObjects,
} from './shared';
import { runWithSqliteRetry } from './sqlite-retry';

export {
    getDefaultMiniMaxCodeDataDir,
    resolveMiniMaxCodeDataDir,
    resolveMiniMaxCodeRuntimeDbPath,
    resolveMiniMaxCodeSessionsDir,
};

const READ_CONCURRENCY = 8;
const minimaxCodeDeleteLimiter = createConcurrencyLimiter(1);
const WORKSPACE_KEY_PREFIX = 'workspace:';
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

type ReadSnapshotOptions = {
    includeRawPayloads?: boolean;
};

type SessionStats = {
    assistantMessageCount: number;
    messageCount: number;
    reasoningCount: number;
    renderablePartCount: number;
    toolCallCount: number;
    toolResultCount: number;
    userMessageCount: number;
};

const getWorkspaceKey = (worktree: string): string => `${WORKSPACE_KEY_PREFIX}${encodeURIComponent(worktree)}`;

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

const getWorkspaceLabel = (worktree: string): string => getPortablePathBasename(worktree) || worktree;

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

const parseJsonValue = (value: string | null): JsonValue | null => {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value) as JsonValue;
    } catch {
        return null;
    }
};

const textFromToolResult = (value: string | null): string | null => {
    const parsed = parseJsonValue(value);
    const result = asObject(parsed);
    const content = result?.content;
    if (!Array.isArray(content)) {
        return value?.trim() || null;
    }

    const text = content
        .flatMap((item) => {
            const itemObject = asObject(item);
            const itemText = asString(itemObject?.text ?? null)?.trim();
            return itemText ? [itemText] : [];
        })
        .join('\n\n')
        .trim();
    return text || null;
};

const commandFromToolArguments = (value: string | null): string | null => {
    return asString(asObject(parseJsonValue(value))?.command ?? null)?.trim() || null;
};

const normalizeToolStatus = (value: JsonValue | undefined): MiniMaxCodeToolStatus => {
    if (value === 2 || value === '2') {
        return 'succeeded';
    }
    if (value === 3 || value === '3') {
        return 'failed';
    }
    return 'unknown';
};

const parseToolCall = (value: JsonValue, includeRawPayloads: boolean): MiniMaxCodeToolCall | null => {
    const raw = asObject(value);
    if (!raw) {
        return null;
    }

    const argumentsText = asString(raw.tool_call_args ?? null);
    const resultText = asString(raw.tool_call_result_data ?? null);
    return {
        argumentsText,
        callId: asString(raw.tool_call_id ?? null),
        command: commandFromToolArguments(argumentsText),
        outputText: textFromToolResult(resultText),
        raw: includeRawPayloads ? raw : {},
        status: normalizeToolStatus(raw.tool_call_status),
        toolName: asString(raw.tool_name ?? null)?.trim() || 'unknown',
    };
};

const parseMessageIdentity = (
    raw: Record<string, JsonValue>,
): Pick<MiniMaxCodeTranscriptMessage, 'messageId' | 'messageType' | 'role'> | null => {
    const messageType = asNumber(raw.msg_type ?? null);
    if (messageType !== 1 && messageType !== 2) {
        return null;
    }

    const role = asString(raw.role ?? null);
    if (role !== 'assistant' && role !== 'user') {
        return null;
    }

    const messageId = asString(raw.msg_id ?? null)?.trim();
    return messageId ? { messageId, messageType, role } : null;
};

const parseToolCalls = (value: JsonValue | undefined, includeRawPayloads: boolean): MiniMaxCodeToolCall[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((toolCall) => {
        const parsed = parseToolCall(toolCall, includeRawPayloads);
        return parsed ? [parsed] : [];
    });
};

const parseMessage = (value: JsonValue, includeRawPayloads: boolean): MiniMaxCodeTranscriptMessage | null => {
    const raw = asObject(value);
    if (!raw) {
        return null;
    }

    const identity = parseMessageIdentity(raw);
    if (!identity) {
        return null;
    }

    return {
        content: asString(raw.msg_content ?? null)?.trim() || null,
        createdAtMs: asNumber(raw.timestamp ?? null),
        finishReason: asString(raw.finish_reason ?? null),
        ...identity,
        raw: includeRawPayloads ? raw : {},
        reasoning: asString(raw.thinking_content ?? null)?.trim() || null,
        thinkingDurationMs: asNumber(raw.thinking_duration_ms ?? null),
        toolCalls: parseToolCalls(raw.tool_calls, includeRawPayloads),
    };
};

const textFromMessageContent = (value: JsonValue | undefined): string | null => {
    if (typeof value === 'string') {
        return value.trim() || null;
    }
    if (!Array.isArray(value)) {
        return null;
    }

    const text = value
        .flatMap((part) => {
            const partObject = asObject(part);
            const partText = asString(partObject?.text ?? null)?.trim();
            return partText ? [partText] : [];
        })
        .join('\n\n')
        .trim();
    return text || null;
};

const serializeJsonValue = (value: JsonValue | undefined): string | null => {
    if (value === undefined) {
        return null;
    }
    return JSON.stringify(value);
};

type ParsedMiniMaxCodeToolResult = {
    outputText: string | null;
    status: MiniMaxCodeToolStatus;
};

type NewMessageParsingContext = {
    includeRawPayloads: boolean;
    pendingToolResults: Map<string, ParsedMiniMaxCodeToolResult>;
    toolCallsById: Map<string, MiniMaxCodeToolCall>;
};

const getNewMessageContentParts = (message: Record<string, JsonValue>): Record<string, JsonValue>[] => {
    return Array.isArray(message.content)
        ? message.content.flatMap((part) => {
              const partObject = asObject(part);
              return partObject ? [partObject] : [];
          })
        : [];
};

const consumeNewToolResult = (
    message: Record<string, JsonValue>,
    context: Pick<NewMessageParsingContext, 'pendingToolResults' | 'toolCallsById'>,
) => {
    const toolCallId = asString(message.toolCallId ?? null)?.trim();
    if (!toolCallId) {
        return;
    }

    const result = {
        outputText: textFromMessageContent(message.content),
        status: asBoolean(message.isError ?? null) ? 'failed' : 'succeeded',
    } satisfies ParsedMiniMaxCodeToolResult;
    const toolCall = context.toolCallsById.get(toolCallId);
    if (toolCall) {
        toolCall.outputText = result.outputText;
        toolCall.status = result.status;
        return;
    }
    context.pendingToolResults.set(toolCallId, result);
};

const parseNewToolCall = (
    part: Record<string, JsonValue>,
    context: NewMessageParsingContext,
): MiniMaxCodeToolCall | null => {
    if (part.type !== 'toolCall') {
        return null;
    }

    const callId = asString(part.id ?? null)?.trim() || null;
    const argumentsText = serializeJsonValue(part.arguments);
    const pendingResult = callId ? context.pendingToolResults.get(callId) : undefined;
    const toolCall: MiniMaxCodeToolCall = {
        argumentsText,
        callId,
        command: commandFromToolArguments(argumentsText),
        outputText: pendingResult?.outputText ?? null,
        raw: context.includeRawPayloads ? part : {},
        status: pendingResult?.status ?? 'unknown',
        toolName: asString(part.name ?? null)?.trim() || 'unknown',
    };
    if (callId) {
        context.toolCallsById.set(callId, toolCall);
        context.pendingToolResults.delete(callId);
    }
    return toolCall;
};

const parseNewTranscriptMessage = (
    row: Record<string, JsonValue>,
    message: Record<string, JsonValue>,
    context: NewMessageParsingContext,
): MiniMaxCodeTranscriptMessage | null => {
    const role = asString(message.role ?? null);
    if (role !== 'assistant' && role !== 'user') {
        return null;
    }

    const messageId = asString(row.message_id ?? null)?.trim() || asString(message.id ?? null)?.trim();
    if (!messageId) {
        return null;
    }

    const contentParts = getNewMessageContentParts(message);
    const reasoning = contentParts
        .flatMap((part) => {
            const thinking = asString(part.thinking ?? null)?.trim();
            return part.type === 'thinking' && thinking ? [thinking] : [];
        })
        .join('\n\n')
        .trim();
    const toolCalls = contentParts.flatMap((part) => {
        const toolCall = parseNewToolCall(part, context);
        return toolCall ? [toolCall] : [];
    });

    return {
        content: textFromMessageContent(message.content),
        createdAtMs: asNumber(message.timestamp ?? null),
        finishReason: asString(message.stopReason ?? null),
        messageId,
        messageType: role === 'user' ? 1 : 2,
        raw: context.includeRawPayloads ? message : {},
        reasoning: reasoning || null,
        role,
        thinkingDurationMs: asNumber(message.thinkingDurationMs ?? null),
        toolCalls,
    };
};

const parseNewMessageLog = async (
    messagesPath: string,
    includeRawPayloads: boolean,
): Promise<MiniMaxCodeTranscriptMessage[]> => {
    const messages: MiniMaxCodeTranscriptMessage[] = [];
    const context: NewMessageParsingContext = {
        includeRawPayloads,
        pendingToolResults: new Map(),
        toolCallsById: new Map(),
    };

    for await (const row of readJsonlObjects(messagesPath)) {
        const message = asObject(row.message ?? null);
        if (!message) {
            continue;
        }

        if (message.role === 'toolResult') {
            consumeNewToolResult(message, context);
            continue;
        }

        const parsedMessage = parseNewTranscriptMessage(row, message, context);
        if (parsedMessage) {
            messages.push(parsedMessage);
        }
    }

    return messages;
};

const getSessionStats = (messages: MiniMaxCodeTranscriptMessage[]): SessionStats => {
    const toolCalls = messages.flatMap((message) => message.toolCalls);
    const userMessageCount = messages.filter((message) => message.role === 'user').length;
    const assistantMessageCount = messages.filter((message) => message.role === 'assistant').length;
    const reasoningCount = messages.filter((message) => Boolean(message.reasoning)).length;
    const toolResultCount = toolCalls.filter((toolCall) => Boolean(toolCall.outputText)).length;
    const renderablePartCount =
        messages.filter((message) => Boolean(message.content)).length +
        reasoningCount +
        toolCalls.length +
        toolResultCount;
    return {
        assistantMessageCount,
        messageCount: userMessageCount + assistantMessageCount,
        reasoningCount,
        renderablePartCount,
        toolCallCount: toolCalls.length,
        toolResultCount,
        userMessageCount,
    };
};

const getLatestPiHistoryModel = (value: JsonValue | undefined): string | null => {
    if (!Array.isArray(value)) {
        return null;
    }

    for (let index = value.length - 1; index >= 0; index -= 1) {
        const entry = asObject(value[index]);
        const model = asString(entry?.model ?? null)?.trim();
        if (!model) {
            continue;
        }

        const provider = asString(entry?.provider ?? null)?.trim();
        return provider && !model.includes('/') ? `${provider}/${model}` : model;
    }

    return null;
};

const getSessionModelId = (record: Record<string, JsonValue>, piHistory?: JsonValue): string | null => {
    return asString(record.effectiveModel ?? null)?.trim() || getLatestPiHistoryModel(piHistory);
};

const toSessionSummary = (
    snapshotPath: string,
    record: Record<string, JsonValue>,
    sessionId: string,
    messages: MiniMaxCodeTranscriptMessage[],
    piHistory?: JsonValue,
): MiniMaxCodeSessionSummary | null => {
    const worktree = asString(record.workspaceDir ?? null)?.trim();
    if (!worktree) {
        return null;
    }

    const stats = getSessionStats(messages);
    const title = cleanInlineTitle(asString(record.title ?? null) || sessionId) || sessionId;
    return {
        agentName: asString(record.agentName ?? null),
        appMode: asString(record.appMode ?? null),
        archived: asBoolean(record.archived ?? null),
        ...stats,
        createdAtMs: asNumber(record.createdAtMs ?? null),
        currentModelId: getSessionModelId(record, piHistory),
        currentModelVariant: asString(record.effectiveModelVariant ?? null),
        lastActiveAtMs: asNumber(record.updatedAtMs ?? null),
        runtime: asString(record.runtime ?? null),
        sessionDir: path.dirname(snapshotPath),
        sessionId,
        sessionType: asString(record.sessionType ?? null),
        snapshotPath,
        status: asString(record.status ?? null),
        title,
        workspaceKey: getWorkspaceKey(worktree),
        workspaceLabel: getWorkspaceLabel(worktree),
        worktree,
    };
};

const readSnapshot = async (
    snapshotPath: string,
    options: ReadSnapshotOptions = {},
): Promise<MiniMaxCodeSessionTranscript | null> => {
    const parsed = (await Bun.file(snapshotPath)
        .json()
        .catch(() => null)) as JsonValue | null;
    const root = asObject(parsed);
    const record = asObject(root?.record ?? null);
    const sessionId = asString(record?.sessionId ?? null) ?? asString(root?.sessionId ?? null);
    if (!root || !record || !sessionId || !Array.isArray(root.displayMessages)) {
        return null;
    }

    const includeRawPayloads = options.includeRawPayloads ?? true;
    const messages = root.displayMessages.flatMap((message) => {
        const parsedMessage = parseMessage(message, includeRawPayloads);
        return parsedMessage ? [parsedMessage] : [];
    });
    const session = toSessionSummary(snapshotPath, record, sessionId, messages, root.piHistory);
    if (!session) {
        return null;
    }

    return {
        messages,
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
        renderablePartCount: session.renderablePartCount,
        session,
    };
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
    const messages = await parseNewMessageLog(messagesPath, includeRawPayloads);
    const session = toSessionSummary(messagesPath, record, sessionId, messages);
    if (!session) {
        return null;
    }

    return {
        messages,
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
        renderablePartCount: session.renderablePartCount,
        session,
    };
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
