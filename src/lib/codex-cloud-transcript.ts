import type {
    MessageEvent,
    TaskCompleteEvent,
    TaskStartedEvent,
    ThreadEvent,
    ToolCallEvent,
    ToolOutputEvent,
} from './codex-browser-types';
import type { JsonValue } from './shared-text';

export type CloudRecord = Record<string, unknown>;

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

const isRecord = (value: unknown): value is CloudRecord => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const asRecord = (value: unknown): CloudRecord | null => (isRecord(value) ? value : null);

export const asString = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

export const asFiniteNumber = (value: unknown): number | null => {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? number : null;
};

export const toIsoTimestamp = (value: unknown): string | null => {
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

export const pickFirstRecord = (...values: unknown[]) =>
    values.map(asRecord).find((value): value is CloudRecord => value !== null) ?? null;

const sensitiveKeyPattern =
    /^(?:access[_-]?token|api[_-]?key|authorization|cookie|debug[_-]?metadata|encrypted[_-]?content|env[_-]?vars?|headers?|permissions?|proxy[_-]?events?|refresh[_-]?token|secret|secrets|setup|token)$/iu;

export const toSafeJsonValue = (value: unknown, depth = 0): JsonValue => {
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
    const durationMs = asFiniteNumber(item.durationMs ?? item.duration_ms);

    return {
        callId: itemCallId(item),
        exitCode: asFiniteNumber(item.exitCode ?? item.exit_code),
        kind: 'tool_output',
        outputText,
        raw: rawEvent('tool_output', item, { output: outputText }),
        sequence: 0,
        summary,
        timestamp: eventTimestamp(event, item, fallbackTimestamp),
        wallTime: durationMs === null ? null : `${durationMs} ms`,
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

export const normalizeCodexCloudTurn = (value: unknown, userTurn: CloudRecord | null = null): CodexCloudTurn => {
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
