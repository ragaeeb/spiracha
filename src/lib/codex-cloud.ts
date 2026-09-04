import os from 'node:os';
import path from 'node:path';
import type {
    DynamicToolDefinition,
    MessageEvent,
    TaskCompleteEvent,
    TaskStartedEvent,
    ThreadEvent,
    ThreadTranscriptStats,
    ToolCallEvent,
    ToolOutputEvent,
} from './codex-browser-types';
import type { JsonValue } from './shared';

const CODEX_CLOUD_BASE_URL = 'https://chatgpt.com/backend-api/wham';
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_TASKS = 200;
const MAX_CURSOR_PAGES = 100;

type CloudRecord = Record<string, unknown>;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CodexCloudAuth = {
    accessToken: string;
    accountId: string;
};

export type CodexCloudDiffStats = {
    filesModified: number | null;
    linesAdded: number | null;
    linesRemoved: number | null;
};

export type CodexCloudTask = {
    createdAt: string | null;
    diffStats: CodexCloudDiffStats;
    environmentId: string | null;
    environmentLabel: string | null;
    id: string;
    status: string;
    taskUrl: string;
    title: string;
    updatedAt: string | null;
};

export type CodexCloudProject = {
    environmentId: string | null;
    id: string;
    label: string;
    lastUpdatedAt: string | null;
    partial: boolean;
    statuses: string[];
    tasks: CodexCloudTask[];
    taskCount: number;
};

export type CodexCloudTurn = {
    branch: string | null;
    createdAt: string | null;
    environmentId: string | null;
    environmentLabel: string | null;
    id: string | null;
    model: string | null;
    outputItems?: unknown[];
    status: string | null;
    threadEvents: {
        events: unknown[];
    };
    userInputItems?: unknown[];
    worklog?: unknown;
};

export type CodexCloudTaskDetail = {
    availableTools: DynamicToolDefinition[];
    branch: string | null;
    currentTurnId: string | null;
    diff: {
        patch: string | null;
        stats: CodexCloudDiffStats;
    };
    environmentId: string | null;
    environmentLabel: string | null;
    events: ThreadEvent[];
    model: string | null;
    projectId: string;
    projectLabel: string;
    safeJson: JsonValue;
    status: string | null;
    task: CodexCloudTask;
};

export type CodexCloudTaskList = {
    cursor: string | null;
    partial: boolean;
    tasks: CodexCloudTask[];
};

type CodexCloudClientOptions = {
    fetchImpl?: FetchImplementation;
    listCommandImpl?: (options: { cursor?: string; limit: number }) => Promise<unknown>;
    maxTasks?: number;
    readAuth?: () => Promise<CodexCloudAuth>;
    refreshAuth?: () => Promise<void>;
};

type CloudListResponse = {
    cursor?: unknown;
    items?: unknown;
    tasks?: unknown;
};

type CloudClient = {
    getTask: (taskId: string) => Promise<CodexCloudTaskDetail>;
    listProject: (projectId: string) => Promise<CodexCloudProject>;
    listProjects: () => Promise<CodexCloudProject[]>;
    listTasks: () => Promise<CodexCloudTaskList>;
};

export class CodexCloudError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null = null) {
        super(message);
        this.name = 'CodexCloudError';
        this.status = status;
    }
}

const isRecord = (value: unknown): value is CloudRecord => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const asRecord = (value: unknown): CloudRecord | null => (isRecord(value) ? value : null);

const asString = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const asFiniteNumber = (value: unknown): number | null => {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? number : null;
};

const asNonNegativeInteger = (value: unknown): number | null => {
    const number = asFiniteNumber(value);
    return number !== null && number >= 0 ? Math.round(number) : null;
};

const toIsoTimestamp = (value: unknown): string | null => {
    if (typeof value === 'number') {
        const milliseconds = value > 10_000_000_000 ? value : value * 1000;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const string = asString(value);
    if (!string) {
        return null;
    }

    const date = new Date(string);
    return Number.isNaN(date.getTime()) ? string : date.toISOString();
};

const pickFirstRecord = (...values: unknown[]) =>
    values.map(asRecord).find((value): value is CloudRecord => value !== null) ?? null;

const getNestedNumber = (record: CloudRecord | null, keys: string[]) => {
    if (!record) {
        return null;
    }

    for (const key of keys) {
        const number = asNonNegativeInteger(record[key]);
        if (number !== null) {
            return number;
        }
    }

    return null;
};

export const normalizeCodexCloudDiffStats = (value: unknown): CodexCloudDiffStats => {
    const record = asRecord(value);
    const nested = pickFirstRecord(
        record?.diff_stats,
        record?.diffStats,
        asRecord(record?.denormalized_metadata)?.diff_stats,
        asRecord(record?.summary)?.diff_stats,
        record?.summary,
        record,
    );

    return {
        filesModified: getNestedNumber(nested, ['files_modified', 'filesModified', 'files_changed', 'files']),
        linesAdded: getNestedNumber(nested, ['lines_added', 'linesAdded', 'additions']),
        linesRemoved: getNestedNumber(nested, ['lines_removed', 'linesRemoved', 'deletions']),
    };
};

const getStatus = (record: CloudRecord) => {
    const display = asRecord(record.task_status_display);
    return asString(record.status) ?? asString(display?.label) ?? asString(display?.status) ?? 'unknown';
};

const getEnvironmentLabel = (record: CloudRecord) => {
    return (
        asString(record.environment_label) ??
        asString(record.environmentLabel) ??
        asString(asRecord(record.environment)?.label) ??
        asString(asRecord(record.creator_workspace)?.label)
    );
};

export const normalizeCodexCloudTask = (value: unknown): CodexCloudTask | null => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }

    const id = asString(record.id) ?? asString(record.task_id);
    if (!id) {
        return null;
    }

    const title = asString(record.title) ?? asString(record.name) ?? `Codex task ${id}`;
    return {
        createdAt: toIsoTimestamp(record.created_at ?? record.createdAt),
        diffStats: normalizeCodexCloudDiffStats(record),
        environmentId: asString(record.environment_id) ?? asString(record.environmentId),
        environmentLabel: getEnvironmentLabel(record),
        id,
        status: getStatus(record),
        taskUrl: `https://chatgpt.com/codex/tasks/${encodeURIComponent(id)}`,
        title,
        updatedAt: toIsoTimestamp(record.updated_at ?? record.updatedAt),
    };
};

const sensitiveKeyPattern =
    /^(?:access[_-]?token|api[_-]?key|authorization|cookie|debug[_-]?metadata|encrypted[_-]?content|env[_-]?vars?|headers?|permissions?|proxy[_-]?events?|refresh[_-]?token|secret|secrets|setup|token)$/iu;

const toSafeJsonValue = (value: unknown, depth = 0): JsonValue => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (depth >= 8) {
        return '[nested value omitted]';
    }

    if (Array.isArray(value)) {
        return value.map((item) => toSafeJsonValue(item, depth + 1));
    }

    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !sensitiveKeyPattern.test(key))
                .map(([key, child]) => [key, toSafeJsonValue(child, depth + 1)]),
        );
    }

    return String(value);
};

const toSafeRawRecord = (value: unknown): Record<string, JsonValue> => {
    const safe = toSafeJsonValue(value);
    return isRecord(safe) ? (safe as Record<string, JsonValue>) : {};
};

const textFromValue = (value: unknown, depth = 0): string => {
    if (depth >= 6 || value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => textFromValue(item, depth + 1))
            .filter(Boolean)
            .join('\n');
    }

    const record = asRecord(value);
    if (!record) {
        return '';
    }

    for (const key of ['text', 'message', 'output', 'content', 'input', 'summary']) {
        const text = textFromValue(record[key], depth + 1);
        if (text) {
            return text;
        }
    }

    return '';
};

const textArrayFromValue = (value: unknown) => {
    if (Array.isArray(value)) {
        return value.map((item) => textFromValue(item)).filter(Boolean);
    }

    const text = textFromValue(value);
    return text ? [text] : [];
};

const itemFromEvent = (value: unknown) => {
    const record = asRecord(value);
    return pickFirstRecord(asRecord(record?.params)?.item, record?.item);
};

const eventMethod = (value: unknown) => asString(asRecord(value)?.method);

const itemType = (item: CloudRecord | null) => asString(item?.type);

const itemId = (item: CloudRecord | null) => asString(item?.id);

const itemCallId = (item: CloudRecord | null) => asString(item?.call_id) ?? asString(item?.callId) ?? itemId(item);

const eventTimestamp = (event: unknown, item: CloudRecord | null, fallback: string | null) => {
    const record = asRecord(event);
    const params = asRecord(record?.params);
    return toIsoTimestamp(item?.created_at ?? item?.createdAt ?? params?.timestamp ?? record?.timestamp) ?? fallback;
};

const rawEvent = (source: string, item: CloudRecord | null, extra: CloudRecord = {}) =>
    toSafeRawRecord({
        source: 'codex-cloud',
        sourceType: source,
        ...item,
        ...extra,
    });

const getArgumentText = (item: CloudRecord) => {
    const value = item.arguments ?? item.input;
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object') {
        return JSON.stringify(value);
    }
    return null;
};

const getCommandFromArguments = (argumentsText: string | null) => {
    if (!argumentsText) {
        return null;
    }

    try {
        const parsed = JSON.parse(argumentsText) as unknown;
        const record = asRecord(parsed);
        return asString(record?.command) ?? asString(record?.cmd) ?? asString(record?.input);
    } catch {
        return null;
    }
};

const getToolCallName = (item: CloudRecord) => {
    const server = asString(item.server);
    const tool = asString(item.tool);
    const name = asString(item.name) ?? tool ?? 'tool';
    return server && tool ? `${server}.${tool}` : name;
};

const makeMessageEvent = (
    item: CloudRecord,
    event: unknown,
    fallbackTimestamp: string | null,
    role: 'assistant' | 'user',
    variant: MessageEvent['variant'],
): MessageEvent => {
    const text = textFromValue(item.text ?? item.message ?? item.content ?? item.input);
    return {
        isHiddenByDefault: false,
        kind: 'message',
        memoryCitation: null,
        model: asString(item.model),
        phase: asString(item.phase),
        raw: rawEvent(asString(item.type) ?? 'message', item, { text }),
        role,
        sequence: 0,
        text,
        timestamp: eventTimestamp(event, item, fallbackTimestamp),
        variant,
    };
};

const makeReasoningEvent = (item: CloudRecord, event: unknown, fallbackTimestamp: string | null) => ({
    content: item.content === undefined ? null : toSafeJsonValue(item.content),
    hasEncryptedContent: Boolean(asString(item.encrypted_content)),
    kind: 'reasoning' as const,
    raw: rawEvent('reasoning', item),
    sequence: 0,
    summary: textArrayFromValue(item.summary),
    timestamp: eventTimestamp(event, item, fallbackTimestamp),
});

const makeToolCallEvent = (item: CloudRecord, event: unknown, fallbackTimestamp: string | null): ToolCallEvent => {
    const argumentsText = getArgumentText(item);
    let argumentsParseFailed = false;
    if (argumentsText) {
        try {
            JSON.parse(argumentsText);
        } catch {
            argumentsParseFailed = true;
        }
    }

    const name = getToolCallName(item);
    return {
        argumentsParseFailed,
        argumentsText,
        callId: itemCallId(item),
        command: asString(item.command) ?? getCommandFromArguments(argumentsText),
        kind: 'tool_call',
        name,
        raw: rawEvent('tool_call', item),
        sequence: 0,
        timestamp: eventTimestamp(event, item, fallbackTimestamp),
        workdir: asString(item.cwd) ?? asString(item.workdir),
    };
};

const makeToolOutputEvent = (item: CloudRecord, event: unknown, fallbackTimestamp: string | null): ToolOutputEvent => {
    const outputText = textFromValue(item.aggregatedOutput ?? item.output ?? item.result ?? item.content);
    const command = asString(item.command);
    const workdir = asString(item.cwd) ?? asString(item.workdir);
    const summary = [
        command ? `Command: ${command}` : null,
        workdir ? `Working directory: ${workdir}` : null,
        outputText,
    ]
        .filter(Boolean)
        .join('\n\n');

    return {
        callId: itemCallId(item),
        exitCode: asFiniteNumber(item.exitCode ?? item.exit_code),
        kind: 'tool_output',
        outputText,
        raw: rawEvent('tool_output', item, { output: outputText }),
        sequence: 0,
        summary,
        timestamp: eventTimestamp(event, item, fallbackTimestamp),
        wallTime: asFiniteNumber(item.durationMs ?? item.duration_ms)
            ? `${asFiniteNumber(item.durationMs ?? item.duration_ms)} ms`
            : null,
    };
};

const makeTaskCompleteEvent = (event: unknown, turn: CodexCloudTurn): TaskCompleteEvent => {
    const record = asRecord(event);
    const params = asRecord(record?.params);
    const item = asRecord(params?.item);
    return {
        completedAt: Date.parse(eventTimestamp(event, item, turn.createdAt) ?? '') || null,
        durationMs: asFiniteNumber(params?.duration_ms ?? item?.durationMs),
        kind: 'task_complete',
        lastAgentMessage: null,
        raw: rawEvent('turn/completed', item, {
            status: turn.status,
            turnId: turn.id,
        }),
        sequence: 0,
        timestamp: eventTimestamp(event, item, turn.createdAt),
        timeToFirstTokenMs: null,
        turnId: turn.id,
    };
};

const makeTaskStartedEvent = (event: unknown, turn: CodexCloudTurn): TaskStartedEvent => ({
    collaborationModeKind: null,
    kind: 'task_started',
    modelContextWindow: null,
    raw: rawEvent('turn/started', null, { turnId: turn.id }),
    sequence: 0,
    startedAt: Date.parse(eventTimestamp(event, null, turn.createdAt) ?? '') || null,
    timestamp: eventTimestamp(event, null, turn.createdAt),
    turnId: turn.id,
});

const makeFileChangeMessage = (item: CloudRecord, event: unknown, fallbackTimestamp: string | null): MessageEvent => {
    const paths = Array.isArray(item.changes)
        ? item.changes
              .map((change) => asString(asRecord(change)?.path) ?? asString(asRecord(change)?.file_path))
              .filter((value): value is string => value !== null)
        : [];
    const text =
        paths.length > 0 ? `Changed files:\n${paths.map((file) => `- ${file}`).join('\n')}` : 'File changes recorded.';
    return {
        isHiddenByDefault: true,
        kind: 'message',
        memoryCitation: null,
        model: null,
        phase: null,
        raw: rawEvent('fileChange', item, { paths }),
        role: 'assistant',
        sequence: 0,
        text,
        timestamp: eventTimestamp(event, item, fallbackTimestamp),
        variant: 'agent_message',
    };
};

const mapCompletedMessageItem = (
    item: CloudRecord,
    event: unknown,
    turn: CodexCloudTurn,
    state: EventMapState,
    role: 'assistant' | 'user',
) => {
    return rememberCanonicalMessage(item, state, role)
        ? [makeMessageEvent(item, event, turn.createdAt, role, role === 'user' ? 'user_message' : 'agent_message')]
        : [];
};

const mapCompletedCommandItem = (item: CloudRecord, event: unknown, turn: CodexCloudTurn, state: EventMapState) => {
    const mapped: ThreadEvent[] = [makeToolOutputEvent(item, event, turn.createdAt)];
    const callId = itemCallId(item);
    if (callId && state.rawToolCallIds.has(callId)) {
        return mapped;
    }
    if (state.rawToolCallFallbackBudget > 0) {
        state.rawToolCallFallbackBudget -= 1;
        return mapped;
    }
    mapped.unshift(makeToolCallEvent(item, event, turn.createdAt));
    return mapped;
};

const mapCompletedMcpItem = (item: CloudRecord, event: unknown, turn: CodexCloudTurn) => {
    return [
        makeToolCallEvent(item, event, turn.createdAt),
        ...(item.result !== undefined || item.output !== undefined
            ? [makeToolOutputEvent(item, event, turn.createdAt)]
            : []),
    ];
};

const assignEventSequences = (events: ThreadEvent[]) => events.map((event, sequence) => ({ ...event, sequence }));

const isTerminalCloudTurn = (status: string | null) =>
    ['cancelled', 'canceled', 'complete', 'completed', 'error', 'failed', 'succeeded', 'success'].includes(
        status?.toLowerCase() ?? '',
    );

const normalizeFinalAnswer = (events: ThreadEvent[], status: string | null) => {
    const assistantMessages = events.filter(
        (event): event is MessageEvent =>
            event.kind === 'message' && event.role === 'assistant' && !event.isHiddenByDefault,
    );
    const finalMessage =
        assistantMessages.filter((event) => event.phase === 'final_answer').at(-1) ??
        (isTerminalCloudTurn(status)
            ? assistantMessages.filter((event) => event.phase !== 'commentary').at(-1)
            : undefined);
    if (!finalMessage) {
        return events;
    }

    return events.map((event) => {
        if (event === finalMessage) {
            return { ...event, phase: 'final_answer' };
        }
        if (event.kind === 'message' && event.role === 'assistant' && event.phase === 'final_answer') {
            return { ...event, phase: null };
        }
        return event;
    });
};

const mapFallbackOutputItem = (item: unknown, turn: CodexCloudTurn): MessageEvent | null => {
    const record = asRecord(item);
    if (!record) {
        return null;
    }

    const text = textFromValue(record.text ?? record.message ?? record.content);
    if (!text) {
        return null;
    }

    return makeMessageEvent(record, null, turn.createdAt, 'assistant', 'agent_message');
};

type EventMapState = {
    canonicalReasoningMirrorBudget: number;
    canonicalMessageIds: Set<string>;
    canonicalToolOutputIds: Set<string>;
    hasCanonicalAssistantMessage: boolean;
    hasCanonicalUserMessage: boolean;
    rawToolCallFallbackBudget: number;
    rawToolCallIds: Set<string>;
};

const rememberCanonicalMessage = (item: CloudRecord, state: EventMapState, role: 'assistant' | 'user') => {
    const id = itemId(item);
    if (id && state.canonicalMessageIds.has(id)) {
        return false;
    }
    if (id) {
        state.canonicalMessageIds.add(id);
    }
    if (role === 'assistant') {
        state.hasCanonicalAssistantMessage = true;
    } else {
        state.hasCanonicalUserMessage = true;
    }
    return true;
};

const mapCompletedCloudItem = (
    item: CloudRecord | null,
    event: unknown,
    turn: CodexCloudTurn,
    state: EventMapState,
): ThreadEvent[] => {
    if (!item) {
        return [];
    }

    const type = itemType(item);
    if (type === 'userMessage' || type === 'user_message') {
        return mapCompletedMessageItem(item, event, turn, state, 'user');
    }
    if (type === 'agentMessage' || type === 'agent_message') {
        return mapCompletedMessageItem(item, event, turn, state, 'assistant');
    }
    if (type === 'reasoning') {
        if (state.canonicalReasoningMirrorBudget > 0) {
            state.canonicalReasoningMirrorBudget -= 1;
            return [];
        }
        return [makeReasoningEvent(item, event, turn.createdAt)];
    }
    if (type === 'commandExecution' || type === 'command_execution') {
        return mapCompletedCommandItem(item, event, turn, state);
    }
    if (type === 'mcpToolCall' || type === 'mcp_tool_call' || type === 'customToolCall') {
        return mapCompletedMcpItem(item, event, turn);
    }
    if (type === 'fileChange' || type === 'file_change') {
        return [makeFileChangeMessage(item, event, turn.createdAt)];
    }
    return [];
};

const mapRawCloudItem = (item: CloudRecord | null, event: unknown, turn: CodexCloudTurn, state: EventMapState) => {
    const type = itemType(item);
    if (!item || type === 'message') {
        return [];
    }
    if (type === 'reasoning') {
        return [makeReasoningEvent(item, event, turn.createdAt)];
    }
    if (type === 'function_call' || type === 'custom_tool_call') {
        return [makeToolCallEvent(item, event, turn.createdAt)];
    }
    if (type === 'function_call_output' || type === 'custom_tool_call_output') {
        const callId = itemCallId(item);
        if (callId && state.canonicalToolOutputIds.has(callId)) {
            return [];
        }
        return [makeToolOutputEvent(item, event, turn.createdAt)];
    }
    return [];
};

const mapCloudEvent = (event: unknown, turn: CodexCloudTurn, state: EventMapState): ThreadEvent[] => {
    const method = eventMethod(event);
    if (method === 'item/completed') {
        return mapCompletedCloudItem(itemFromEvent(event), event, turn, state);
    }
    if (method === 'rawResponseItem/completed') {
        return mapRawCloudItem(itemFromEvent(event), event, turn, state);
    }
    if (method === 'turn/completed') {
        return [makeTaskCompleteEvent(event, turn)];
    }
    return method === 'turn/started' ? [makeTaskStartedEvent(event, turn)] : [];
};

const findRawCloudMessage = (turn: CodexCloudTurn, role: 'assistant' | 'user') =>
    turn.threadEvents.events
        .filter((event) => eventMethod(event) === 'rawResponseItem/completed')
        .map(itemFromEvent)
        .find((item) => item !== null && itemType(item) === 'message' && asString(item.role) === role);

const addUserFallback = (events: ThreadEvent[], turn: CodexCloudTurn, state: EventMapState) => {
    if (state.hasCanonicalUserMessage) {
        return;
    }
    const rawUserMessage = findRawCloudMessage(turn, 'user');
    if (rawUserMessage) {
        events.unshift(makeMessageEvent(rawUserMessage, null, turn.createdAt, 'user', 'user_message'));
        return;
    }
    const fallbackInput = turn.userInputItems
        ?.map((item) => textFromValue(item))
        .filter(Boolean)
        .join('\n');
    if (fallbackInput) {
        events.unshift(
            makeMessageEvent(
                { content: fallbackInput, type: 'userMessage' },
                null,
                turn.createdAt,
                'user',
                'user_message',
            ),
        );
    }
};

const addAssistantFallback = (events: ThreadEvent[], turn: CodexCloudTurn, state: EventMapState) => {
    if (state.hasCanonicalAssistantMessage) {
        return;
    }
    const rawAssistantMessages = turn.threadEvents.events
        .filter((event) => eventMethod(event) === 'rawResponseItem/completed')
        .map(itemFromEvent)
        .filter(
            (item): item is CloudRecord =>
                item !== null && itemType(item) === 'message' && asString(item.role) === 'assistant',
        );
    for (const item of rawAssistantMessages) {
        events.push(makeMessageEvent(item, null, turn.createdAt, 'assistant', 'agent_message'));
    }
};

const addOutputFallback = (events: ThreadEvent[], turn: CodexCloudTurn) => {
    if (!turn.outputItems || events.some((event) => event.kind === 'message' && event.role === 'assistant')) {
        return;
    }
    for (const item of turn.outputItems) {
        const mapped = mapFallbackOutputItem(item, turn);
        if (mapped) {
            events.push(mapped);
        }
    }
};

export const mapCodexCloudTurnEvents = (turn: CodexCloudTurn): ThreadEvent[] => {
    const events: ThreadEvent[] = [];
    const completedCommandCallIds = new Set(
        turn.threadEvents.events
            .filter((event) => eventMethod(event) === 'item/completed')
            .map(itemFromEvent)
            .filter(
                (item): item is CloudRecord =>
                    item !== null && ['commandExecution', 'command_execution'].includes(itemType(item) ?? ''),
            )
            .map(itemCallId)
            .filter((callId): callId is string => callId !== null),
    );
    const rawToolCallItems = turn.threadEvents.events
        .filter((event) => eventMethod(event) === 'rawResponseItem/completed')
        .map(itemFromEvent)
        .filter(
            (item): item is CloudRecord =>
                item !== null && ['function_call', 'custom_tool_call'].includes(itemType(item) ?? ''),
        );
    const state: EventMapState = {
        canonicalMessageIds: new Set<string>(),
        canonicalReasoningMirrorBudget: turn.threadEvents.events.filter(
            (event) =>
                eventMethod(event) === 'rawResponseItem/completed' && itemType(itemFromEvent(event)) === 'reasoning',
        ).length,
        canonicalToolOutputIds: new Set(
            turn.threadEvents.events
                .filter((event) => eventMethod(event) === 'item/completed')
                .map(itemFromEvent)
                .filter(
                    (item): item is CloudRecord =>
                        item !== null &&
                        ['commandExecution', 'command_execution'].includes(itemType(item) ?? '') &&
                        itemCallId(item) !== null,
                )
                .map((item) => itemCallId(item)!)
                .filter((callId): callId is string => callId !== null),
        ),
        hasCanonicalAssistantMessage: false,
        hasCanonicalUserMessage: false,
        rawToolCallFallbackBudget: rawToolCallItems.filter((item) => {
            const callId = itemCallId(item);
            return !callId || !completedCommandCallIds.has(callId);
        }).length,
        rawToolCallIds: new Set(
            rawToolCallItems.map((item) => itemCallId(item)).filter((callId): callId is string => callId !== null),
        ),
    };
    for (const event of turn.threadEvents.events) {
        events.push(...mapCloudEvent(event, turn, state));
    }
    addUserFallback(events, turn, state);
    addAssistantFallback(events, turn, state);
    addOutputFallback(events, turn);

    const normalized = normalizeFinalAnswer(assignEventSequences(events), turn.status);
    const finalText = normalized
        .slice()
        .reverse()
        .find(
            (event): event is MessageEvent =>
                event.kind === 'message' && event.role === 'assistant' && event.phase === 'final_answer',
        )?.text;

    return normalized.map((event) =>
        event.kind === 'task_complete' ? { ...event, lastAgentMessage: finalText ?? null } : event,
    );
};

export const buildCodexCloudTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    const assistantMessages = events.filter((event) => event.kind === 'message' && event.role === 'assistant');
    return {
        assistantMessageCount: assistantMessages.length,
        commentaryCount: assistantMessages.filter((event) => event.kind === 'message' && event.phase === 'commentary')
            .length,
        execCommandCount: events.filter(
            (event) => event.kind === 'tool_call' && (event.name === 'exec_command' || event.command !== null),
        ).length,
        finalAnswerCount: assistantMessages.filter(
            (event) => event.kind === 'message' && event.phase === 'final_answer',
        ).length,
        messageCount: events.filter((event) => event.kind === 'message').length,
        modelNames: [
            ...new Set(
                events
                    .filter((event): event is MessageEvent => event.kind === 'message' && Boolean(event.model))
                    .map((event) => event.model!)
                    .filter(Boolean),
            ),
        ],
        toolCallCount: events.filter((event) => event.kind === 'tool_call').length,
        toolOutputCount: events.filter((event) => event.kind === 'tool_output').length,
        userMessageCount: events.filter((event) => event.kind === 'message' && event.role === 'user').length,
        webSearchEventCount: events.filter((event) => event.kind === 'web_search').length,
    };
};

const getObservedTools = (events: ThreadEvent[]): DynamicToolDefinition[] => {
    return [
        ...new Map(
            events
                .filter((event): event is ToolCallEvent => event.kind === 'tool_call')
                .map((event) => [event.name, event.name]),
        ).values(),
    ].map((name) => ({
        deferLoading: false,
        description: 'Observed in the Codex Cloud transcript.',
        inputSchema: null,
        name,
        namespace: null,
    }));
};

const normalizeCloudTurn = (value: unknown, userTurn: CloudRecord | null): CodexCloudTurn => {
    const record = asRecord(value) ?? {};
    const threadEvents = asRecord(record.thread_events);
    const events = Array.isArray(threadEvents?.events) ? threadEvents.events : [];
    const outputItems = Array.isArray(record.output_items) ? record.output_items : undefined;
    return {
        branch: asString(record.branch_name) ?? asString(record.branch),
        createdAt: toIsoTimestamp(record.created_at ?? record.createdAt),
        environmentId: asString(record.environment_id),
        environmentLabel: asString(asRecord(record.environment)?.label),
        id: asString(record.id) ?? asString(record.turn_id),
        model: asString(record.model_version) ?? asString(record.model),
        outputItems,
        status: asString(record.turn_status) ?? asString(record.status),
        threadEvents: { events },
        userInputItems: Array.isArray(userTurn?.input_items) ? userTurn.input_items : undefined,
        worklog: record.worklog,
    };
};

const findTextByKeys = (value: unknown, keys: string[], depth = 0): string | null => {
    if (depth >= 6) {
        return null;
    }
    if (Array.isArray(value)) {
        for (const child of value) {
            const found = findTextByKeys(child, keys, depth + 1);
            if (found) {
                return found;
            }
        }
        return null;
    }
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    for (const key of keys) {
        const found = asString(record[key]);
        if (found) {
            return found;
        }
    }
    for (const child of Object.values(record)) {
        const found = findTextByKeys(child, keys, depth + 1);
        if (found) {
            return found;
        }
    }
    return null;
};

const buildSafeTaskDetailJson = (
    task: CodexCloudTask,
    events: ThreadEvent[],
    turn: CodexCloudTurn,
    diff: { patch: string | null; stats: CodexCloudDiffStats },
): JsonValue =>
    toSafeJsonValue({
        diff,
        events: events.map((event) => event.raw),
        task,
        turn: {
            branch: turn.branch,
            createdAt: turn.createdAt,
            environmentId: turn.environmentId,
            eventCount: events.length,
            id: turn.id,
            model: turn.model,
            status: turn.status,
        },
    });

const resolveProjectId = (environmentId: string | null, environmentLabel: string | null, taskId: string) =>
    environmentLabel ? `label:${encodeURIComponent(environmentLabel)}` : (environmentId ?? `task:${taskId}`);

const normalizeTaskWithTurn = (value: unknown, turn: CodexCloudTurn, taskId: string): CodexCloudTask => {
    const record = asRecord(value) ?? {};
    return {
        ...(normalizeCodexCloudTask({ ...record, id: taskId }) ?? {
            createdAt: null,
            diffStats: normalizeCodexCloudDiffStats(record),
            environmentId: null,
            environmentLabel: null,
            id: taskId,
            status: 'unknown',
            taskUrl: `https://chatgpt.com/codex/tasks/${encodeURIComponent(taskId)}`,
            title: `Codex task ${taskId}`,
            updatedAt: null,
        }),
        environmentId: turn.environmentId ?? asString(record.environment_id) ?? asString(record.environmentId),
        environmentLabel: turn.environmentLabel ?? getEnvironmentLabel(record),
    };
};

const resolveAuthPath = () => {
    const configuredAuthPath = process.env.SPIRACHA_CODEX_AUTH?.trim();
    if (configuredAuthPath) {
        return configuredAuthPath;
    }

    const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
    return path.join(codexHome, 'auth.json');
};

const readCodexCloudAuth = async (): Promise<CodexCloudAuth> => {
    let value: unknown;
    try {
        value = await Bun.file(resolveAuthPath()).json();
    } catch {
        throw new CodexCloudError('Codex Cloud login is unavailable. Run `codex login` and try again.');
    }

    const tokens = asRecord(asRecord(value)?.tokens);
    const accessToken = asString(tokens?.access_token);
    const accountId = asString(tokens?.account_id);
    if (!accessToken || !accountId) {
        throw new CodexCloudError('Codex Cloud requires a ChatGPT login. Run `codex login` and try again.');
    }

    return { accessToken, accountId };
};

const refreshCodexCloudAuth = async () => {
    const command = process.env.CODEX_BIN?.trim() || 'codex';
    try {
        const child = Bun.spawn([command, 'cloud', 'list', '--json', '--limit', '1'], {
            stderr: 'ignore',
            stdout: 'ignore',
        });
        if ((await child.exited) !== 0) {
            throw new Error('refresh failed');
        }
    } catch {
        throw new CodexCloudError('Codex Cloud login expired. Run `codex login` and try again.');
    }
};

const runCodexCloudList = async ({ cursor, limit }: { cursor?: string; limit: number }) => {
    const command = process.env.CODEX_BIN?.trim() || 'codex';
    const args = ['cloud', 'list', '--json', '--limit', String(limit)];
    if (cursor) {
        args.push('--cursor', cursor);
    }

    try {
        const child = Bun.spawn([command, ...args], { stderr: 'ignore', stdout: 'pipe' });
        const output = await new Response(child.stdout).text();
        if ((await child.exited) !== 0) {
            throw new Error('list failed');
        }
        return JSON.parse(output) as unknown;
    } catch {
        throw new CodexCloudError('Codex Cloud inventory is unavailable. Run `codex login` and try again.');
    }
};

const validateTaskId = (taskId: string) => {
    if (!/^task_[a-z0-9_]+$/iu.test(taskId)) {
        throw new CodexCloudError('Invalid Codex Cloud task id.');
    }
};

const performCloudRequest = async (
    fetchImpl: FetchImplementation,
    endpoint: string,
    searchParams: Record<string, string | undefined>,
    auth: CodexCloudAuth,
) => {
    const url = new URL(`${CODEX_CLOUD_BASE_URL}${endpoint}`);
    for (const [key, value] of Object.entries(searchParams)) {
        if (value) {
            url.searchParams.set(key, value);
        }
    }

    try {
        return await fetchImpl(url, {
            headers: {
                Authorization: `Bearer ${auth.accessToken}`,
                'ChatGPT-Account-Id': auth.accountId,
                'User-Agent': 'spiracha-codex-cloud',
            },
            redirect: 'error',
        });
    } catch {
        throw new CodexCloudError('Codex Cloud could not be reached. Check the network and try again.');
    }
};

const parseCloudResponse = async (response: Response) => {
    if (!response.ok) {
        throw new CodexCloudError(`Codex Cloud request failed (${response.status}).`, response.status);
    }

    try {
        return (await response.json()) as unknown;
    } catch {
        throw new CodexCloudError('Codex Cloud returned an invalid response.');
    }
};

const appendCloudTasks = (rawItems: unknown[], tasks: CodexCloudTask[], seenTaskIds: Set<string>, maxTasks: number) => {
    for (const rawItem of rawItems) {
        const task = normalizeCodexCloudTask(rawItem);
        if (!task || seenTaskIds.has(task.id)) {
            continue;
        }
        seenTaskIds.add(task.id);
        tasks.push(task);
        if (tasks.length >= maxTasks) {
            return;
        }
    }
};

const getCloudListItems = (response: CloudListResponse) => {
    if (Array.isArray(response.items)) {
        return response.items;
    }
    return Array.isArray(response.tasks) ? response.tasks : [];
};

const updateCloudListCursor = ({
    cursor,
    maxTasks,
    nextCursor,
    seenCursors,
    taskCount,
}: {
    cursor: string | undefined;
    maxTasks: number;
    nextCursor: string | null;
    seenCursors: Set<string>;
    taskCount: number;
}) => {
    if (taskCount >= maxTasks || !nextCursor || seenCursors.has(nextCursor)) {
        return {
            cursor: nextCursor ?? cursor,
            done: true,
            partial: Boolean(nextCursor),
        };
    }

    seenCursors.add(nextCursor);
    return { cursor: nextCursor, done: false, partial: false };
};

const groupCloudTasks = (tasks: CodexCloudTask[]) => {
    const groups = new Map<string, CodexCloudTask[]>();
    for (const task of tasks) {
        const key = task.environmentLabel ?? task.environmentId ?? '__unassigned__';
        const group = groups.get(key) ?? [];
        group.push(task);
        groups.set(key, group);
    }
    return groups;
};

const sortCloudTasks = (tasks: CodexCloudTask[]) =>
    [...tasks].sort(
        (left, right) => (Date.parse(right.updatedAt ?? '') || 0) - (Date.parse(left.updatedAt ?? '') || 0),
    );

const buildCloudProject = (key: string, tasks: CodexCloudTask[], partial: boolean): CodexCloudProject => {
    const environmentId = tasks.find((task) => task.environmentId)?.environmentId ?? null;
    const environmentLabel = tasks.find((task) => task.environmentLabel)?.environmentLabel ?? null;
    const sortedTasks = sortCloudTasks(tasks);
    return {
        environmentId,
        id: resolveProjectId(environmentId, environmentLabel, tasks[0]?.id ?? key),
        label: environmentLabel ?? environmentId ?? 'Unassigned Cloud tasks',
        lastUpdatedAt: sortedTasks[0]?.updatedAt ?? null,
        partial,
        statuses: [...new Set(tasks.map((task) => task.status))].sort(),
        taskCount: tasks.length,
        tasks: sortedTasks,
    };
};

export const createCodexCloudClient = (options: CodexCloudClientOptions = {}): CloudClient => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const readAuth = options.readAuth ?? readCodexCloudAuth;
    const refreshAuth = options.refreshAuth ?? refreshCodexCloudAuth;
    const listCommand = options.listCommandImpl ?? (options.fetchImpl ? null : runCodexCloudList);
    const maxTasks = Math.min(Math.max(options.maxTasks ?? DEFAULT_MAX_TASKS, 1), DEFAULT_MAX_TASKS);

    const requestJson = async (endpoint: string, searchParams: Record<string, string | undefined> = {}) => {
        const auth = await readAuth();
        const response = await performCloudRequest(fetchImpl, endpoint, searchParams, auth);
        if (response.status !== 401) {
            return parseCloudResponse(response);
        }

        await refreshAuth();
        const refreshedResponse = await performCloudRequest(fetchImpl, endpoint, searchParams, await readAuth());
        return parseCloudResponse(refreshedResponse);
    };

    const listTasks = async (): Promise<CodexCloudTaskList> => {
        const tasks: CodexCloudTask[] = [];
        const seenTaskIds = new Set<string>();
        const seenCursors = new Set<string>();
        let cursor: string | undefined;
        let partial = false;
        let pages = 0;

        while (tasks.length < maxTasks && pages < MAX_CURSOR_PAGES) {
            pages += 1;
            const response = (
                listCommand
                    ? await listCommand({ cursor, limit: DEFAULT_PAGE_SIZE })
                    : await requestJson('/tasks/list', {
                          cursor,
                          limit: String(DEFAULT_PAGE_SIZE),
                          task_filter: 'current',
                      })
            ) as CloudListResponse;
            const rawItems = getCloudListItems(response);
            appendCloudTasks(rawItems, tasks, seenTaskIds, maxTasks);
            const cursorState = updateCloudListCursor({
                cursor,
                maxTasks,
                nextCursor: asString(response.cursor),
                seenCursors,
                taskCount: tasks.length,
            });
            cursor = cursorState.cursor;
            partial ||= cursorState.partial;
            if (cursorState.done) {
                break;
            }
        }

        if (pages >= MAX_CURSOR_PAGES && cursor) {
            partial = true;
        }

        return { cursor: cursor ?? null, partial, tasks };
    };

    const getTask = async (taskId: string): Promise<CodexCloudTaskDetail> => {
        validateTaskId(taskId);
        const body = asRecord(await requestJson(`/tasks/${encodeURIComponent(taskId)}`)) ?? {};
        const taskRecord = asRecord(body.task) ?? {};
        const userTurn = asRecord(body.current_user_turn);
        const rawTurn = pickFirstRecord(body.current_assistant_turn, body.current_diff_task_turn);
        const turn = normalizeCloudTurn(rawTurn, userTurn);
        const events = mapCodexCloudTurnEvents(turn);
        const environmentId = turn.environmentId ?? asString(taskRecord.environment_id);
        const environmentLabel = turn.environmentLabel ?? getEnvironmentLabel(taskRecord);
        const task = normalizeTaskWithTurn(taskRecord, turn, taskId);
        const diffTurn = asRecord(body.current_diff_task_turn);
        const diffOutput = Array.isArray(diffTurn?.output_items)
            ? diffTurn.output_items.map(asRecord).find((item) => item?.output_diff !== undefined)?.output_diff
            : null;
        const diffTurnStats = normalizeCodexCloudDiffStats(diffOutput ?? diffTurn);
        const taskStats = normalizeCodexCloudDiffStats(taskRecord);
        const stats = {
            filesModified: diffTurnStats.filesModified ?? taskStats.filesModified,
            linesAdded: diffTurnStats.linesAdded ?? taskStats.linesAdded,
            linesRemoved: diffTurnStats.linesRemoved ?? taskStats.linesRemoved,
        };
        const patch = findTextByKeys(body.current_diff_task_turn, ['patch', 'unified_diff', 'diff']);
        const diff = { patch, stats };

        return {
            availableTools: getObservedTools(events),
            branch: turn.branch,
            currentTurnId: turn.id,
            diff,
            environmentId,
            environmentLabel,
            events,
            model: turn.model,
            projectId: resolveProjectId(environmentId, environmentLabel, taskId),
            projectLabel: environmentLabel ?? environmentId ?? 'Unassigned Cloud tasks',
            safeJson: buildSafeTaskDetailJson(task, events, turn, diff),
            status: turn.status,
            task,
        };
    };

    const listProjects = async () => {
        const taskList = await listTasks();
        const groups = groupCloudTasks(taskList.tasks);

        const projects: CodexCloudProject[] = [];
        for (const [key, tasks] of groups) {
            projects.push(buildCloudProject(key, tasks, taskList.partial));
        }

        return projects.sort(
            (left, right) => (Date.parse(right.lastUpdatedAt ?? '') || 0) - (Date.parse(left.lastUpdatedAt ?? '') || 0),
        );
    };

    const listProject = async (projectId: string) => {
        const project = (await listProjects()).find((candidate) => candidate.id === projectId);
        if (!project) {
            throw new CodexCloudError('Codex Cloud project not found. Refresh the Cloud inventory and try again.');
        }
        return project;
    };

    return { getTask, listProject, listProjects, listTasks };
};

export const codexCloudClient = createCodexCloudClient();

export type CodexCloudExportOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
};

const getCloudEventTitle = (event: ThreadEvent, model: string | null) => {
    if (event.kind === 'message') {
        if (event.variant === 'agent_message') {
            return event.role === 'assistant' ? (model ?? 'Assistant') : 'Assistant update';
        }
        return event.role === 'user' ? 'User' : event.role === 'system' ? 'System' : (model ?? 'Assistant');
    }

    switch (event.kind) {
        case 'reasoning':
            return 'Reasoning';
        case 'task_started':
            return 'Task started';
        case 'task_complete':
            return 'Task complete';
        case 'token_count':
            return 'Token update';
        case 'tool_call':
            return `Tool call: ${event.name}`;
        case 'tool_output':
            return 'Tool output';
        case 'web_search':
            return 'Web search';
    }
};

const getCloudEventBody = (event: ThreadEvent) => {
    switch (event.kind) {
        case 'message':
            return event.text || 'No text content';
        case 'reasoning':
            return event.summary.join(' ') || 'Reasoning content is not directly available.';
        case 'task_started':
            return `Context window: ${event.modelContextWindow ?? 'n/a'}\n\nCollaboration mode: ${event.collaborationModeKind ?? 'n/a'}`;
        case 'task_complete':
            return `Duration: ${event.durationMs ?? 'n/a'} ms\n\nFirst token: ${event.timeToFirstTokenMs ?? 'n/a'} ms`;
        case 'token_count':
            return JSON.stringify(event.rateLimits, null, 2);
        case 'tool_call':
            return [
                event.command ? `Command: ${event.command}` : event.name,
                event.workdir ? `Working directory: ${event.workdir}` : null,
            ]
                .filter(Boolean)
                .join('\n\n');
        case 'tool_output':
            return [event.exitCode === null ? null : `Exit code: ${event.exitCode}`, event.summary || event.outputText]
                .filter(Boolean)
                .join('\n\n');
        case 'web_search':
            return [`Phase: ${event.phase}`, event.status, event.query].filter(Boolean).join('\n\n');
    }
};

const shouldIncludeCloudExportEvent = (event: ThreadEvent, options: CodexCloudExportOptions) => {
    if (event.kind === 'message' && event.role === 'assistant' && event.phase === 'commentary') {
        return options.includeCommentary;
    }
    if (event.kind === 'tool_call' || event.kind === 'tool_output' || event.kind === 'web_search') {
        return options.includeTools;
    }
    return true;
};

const getCloudDiffSection = (detail: CodexCloudTaskDetail, outputFormat: 'md' | 'txt') => {
    const { filesModified, linesAdded, linesRemoved } = detail.diff.stats;
    const stats = [
        filesModified === null ? null : `Files changed: ${filesModified}`,
        linesAdded === null ? null : `Additions: +${linesAdded}`,
        linesRemoved === null ? null : `Deletions: -${linesRemoved}`,
    ].filter((value): value is string => value !== null);
    const body = [...stats, detail.diff.patch].filter((value): value is string => Boolean(value)).join('\n\n');
    if (!body) {
        return null;
    }
    return outputFormat === 'md' ? `## Diff\n\n${body}` : `Diff\n\n${body}`;
};

export const renderCodexCloudExport = (detail: CodexCloudTaskDetail, options: CodexCloudExportOptions) => {
    const metadata = [
        `Source: Codex Cloud`,
        `Task ID: ${detail.task.id}`,
        `Project: ${detail.projectLabel}`,
        `Status: ${detail.status ?? detail.task.status}`,
        `Updated: ${detail.task.updatedAt ?? 'n/a'}`,
        `URL: ${detail.task.taskUrl}`,
    ];
    const sections = detail.events
        .filter((event) => shouldIncludeCloudExportEvent(event, options))
        .map((event) => {
            const title = getCloudEventTitle(event, detail.model);
            const body = getCloudEventBody(event);
            return options.outputFormat === 'md' ? `## ${title}\n\n${body}` : `${title}\n\n${body}`;
        });
    const diffSection = getCloudDiffSection(detail, options.outputFormat);
    if (diffSection) {
        sections.push(diffSection);
    }
    const heading = options.outputFormat === 'md' ? `# ${detail.task.title}` : detail.task.title;
    const metadataSection = options.includeMetadata ? `${metadata.join('\n')}\n\n` : '';
    return `${heading}\n\n${metadataSection}${sections.join('\n\n')}`.trimEnd() + '\n';
};
