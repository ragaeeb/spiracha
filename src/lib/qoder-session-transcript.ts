import path from 'node:path';
import { loadQoderAcpSession, type QoderAcpSessionUpdate, resolveQoderAcpSocketPath } from './qoder-acp-client';
import {
    type QoderSessionTranscript,
    type QoderTranscriptEntry,
    resolveQoderCliProjectsDir,
    resolveQoderGlobalStateDb,
    resolveQoderWorkspaceStorageDir,
} from './qoder-exporter-types';
import {
    asJsonObject,
    buildLocalTranscriptEntryGroups,
    createStatsFromEntries,
    getLastActiveAtMs,
    getModelFallback,
    loadQoderRecords,
    normalizeQoderModelLabel,
    parseJsonValue,
    parseTextPart,
    parseTimestampMs,
    pathExists,
    type QoderSessionRecord,
    type QoderStateData,
    readQoderStateData,
    toIso,
    toQoderSessionSummary,
} from './qoder-storage';
import { coalesceQoderMessageChunks } from './qoder-transcript-phase';
import { asObject, asString, type JsonValue } from './shared';

const ACP_RECENT_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

type QoderTranscriptReadOptions = {
    acpDrainMs?: number;
    acpSocketPath?: string | null;
    acpTimeoutMs?: number;
    enableAcp?: boolean;
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
                  toolCallId: asString(data.id ?? data.tool_use_id ?? part.id ?? part.tool_use_id ?? null),
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
        entries: coalesceQoderMessageChunks(
            loaded.events
                .map((event, index) => acpUpdateToEntry(event, index))
                .filter((entry): entry is QoderTranscriptEntry => Boolean(entry)),
        ),
        model: getAcpModel(loaded.events),
        socketPath: loaded.socketPath,
    };
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
    const { modelConfig, records, workspaceStorageIds } = await loadQoderRecords(globalStateDb, workspaceStorageDir);
    const record = records.find((candidate) => candidate.sessionId === sessionId);
    if (!record) {
        return null;
    }

    const state = await readQoderStateData(workspaceStorageDir, workspaceStorageIds, record);
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
        session: toQoderSessionSummary(record, state, stats, model),
    };
};
