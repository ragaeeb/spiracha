import type {
    DynamicToolDefinition,
    MessageEvent,
    ParsedCodexTranscript,
    ReasoningEvent,
    SessionMetaExtended,
    TaskCompleteEvent,
    TaskStartedEvent,
    ThreadEvent,
    ThreadTranscriptStats,
    TokenCountEvent,
    ToolCallEvent,
    ToolOutputEvent,
    TurnContextRecord,
    WebSearchEvent,
} from './codex-browser-types';
import { asNumber, asObject, asString, type JsonValue, readJsonlObjects, stripCodexAppDirectiveLines } from './shared';

type ParseCodexTranscriptOptions = {
    eventFilter?: (event: ThreadEvent) => boolean;
    includeRaw?: boolean;
    maxEvents?: number;
    maxTurnContexts?: number;
    sourceFileSizeBytes?: number | null;
    tailEventLimit?: number;
};

type ParseCodexTranscriptState = {
    events: ThreadEvent[];
    eventFilter: (event: ThreadEvent) => boolean;
    includeRaw: boolean;
    maxEvents: number;
    maxTurnContexts: number;
    sequence: number;
    shouldStop: boolean;
    tailEventLimit: number;
    turnContexts: TurnContextRecord[];
};

const createEmptyStats = (): ThreadTranscriptStats => {
    return {
        assistantMessageCount: 0,
        commentaryCount: 0,
        execCommandCount: 0,
        finalAnswerCount: 0,
        messageCount: 0,
        toolCallCount: 0,
        toolOutputCount: 0,
        userMessageCount: 0,
        webSearchEventCount: 0,
    };
};

const createEmptySessionMeta = (): SessionMetaExtended => {
    return {
        baseInstructions: null,
        cli_version: undefined,
        cwd: undefined,
        dynamicTools: [],
        git: null,
        id: undefined,
        modelProvider: null,
        originator: undefined,
        source: undefined,
        threadSource: null,
        timestamp: undefined,
    };
};

export const parseCodexTranscriptFile = async (
    sessionFile: string,
    options: ParseCodexTranscriptOptions = {},
): Promise<ParsedCodexTranscript> => {
    const sessionMeta = createEmptySessionMeta();
    const turnContexts: TurnContextRecord[] = [];
    const events: ThreadEvent[] = [];
    const stats = createEmptyStats();
    const includeRaw = options.includeRaw ?? true;
    const maxEvents = options.maxEvents ?? Number.POSITIVE_INFINITY;
    const maxTurnContexts = options.maxTurnContexts ?? Number.POSITIVE_INFINITY;
    const tailEventLimit = options.tailEventLimit ?? Number.POSITIVE_INFINITY;
    const eventFilter = options.eventFilter ?? (() => true);
    const state: ParseCodexTranscriptState = {
        eventFilter,
        events,
        includeRaw,
        maxEvents,
        maxTurnContexts,
        sequence: 0,
        shouldStop: false,
        tailEventLimit,
        turnContexts,
    };

    for await (const parsed of readJsonlObjects(sessionFile)) {
        captureSessionMeta(parsed, sessionMeta);
        captureTranscriptRecord(parsed, state);
        if (state.shouldStop) {
            break;
        }
    }

    for (const event of events) {
        updateTranscriptStats(stats, event);
    }

    return {
        events,
        isPartial:
            Number.isFinite(maxEvents) ||
            Number.isFinite(maxTurnContexts) ||
            Number.isFinite(tailEventLimit) ||
            options.eventFilter !== undefined,
        rawIncluded: includeRaw,
        sessionMeta,
        sourceFileSizeBytes: options.sourceFileSizeBytes ?? null,
        stats,
        statsArePartial:
            Number.isFinite(maxEvents) || Number.isFinite(tailEventLimit) || options.eventFilter !== undefined,
        turnContexts,
    };
};

const captureTranscriptRecord = (parsed: Record<string, JsonValue>, state: ParseCodexTranscriptState) => {
    if (asString(parsed.type) === 'turn_context') {
        if (state.turnContexts.length < state.maxTurnContexts) {
            captureTurnContext(parsed, state.turnContexts);
        }
        return;
    }

    const event = parseCodexTranscriptRecord(parsed, state.sequence, state.includeRaw);
    if (!event) {
        return;
    }

    state.sequence += 1;
    if (!state.eventFilter(event)) {
        return;
    }

    state.events.push(event);
    if (state.events.length > state.tailEventLimit) {
        state.events.shift();
    }
    state.shouldStop = state.events.length >= state.maxEvents;
};

const captureSessionMeta = (parsed: Record<string, JsonValue>, sessionMeta: SessionMetaExtended) => {
    if (parsed.type !== 'session_meta') {
        return;
    }

    const payload = asObject(parsed.payload);
    if (!payload) {
        return;
    }

    sessionMeta.baseInstructions = payload.base_instructions ?? sessionMeta.baseInstructions;
    sessionMeta.cli_version = asString(payload.cli_version) ?? sessionMeta.cli_version;
    sessionMeta.cwd = asString(payload.cwd) ?? sessionMeta.cwd;
    sessionMeta.dynamicTools = parseDynamicTools(payload.dynamic_tools) ?? sessionMeta.dynamicTools;
    sessionMeta.git = asObject(payload.git) ?? sessionMeta.git;
    sessionMeta.id = asString(payload.id) ?? sessionMeta.id;
    sessionMeta.modelProvider = asString(payload.model_provider) ?? sessionMeta.modelProvider;
    sessionMeta.originator = asString(payload.originator) ?? sessionMeta.originator;
    sessionMeta.source = asString(payload.source) ?? sessionMeta.source;
    sessionMeta.threadSource = asString(payload.thread_source) ?? sessionMeta.threadSource;
    sessionMeta.timestamp = asString(payload.timestamp) ?? sessionMeta.timestamp;
};

const parseDynamicTools = (value: JsonValue | undefined): DynamicToolDefinition[] | null => {
    if (!Array.isArray(value)) {
        return null;
    }

    return value.flatMap((entry) => {
        const tool = asObject(entry);
        if (!tool) {
            return [];
        }

        return [
            {
                deferLoading: tool.deferLoading === true || tool.defer_loading === true,
                description: asString(tool.description) ?? '',
                inputSchema: asObject(tool.inputSchema) ?? asObject(tool.input_schema) ?? null,
                name: asString(tool.name) ?? 'unknown',
                namespace: asString(tool.namespace),
            },
        ];
    });
};

const captureTurnContext = (parsed: Record<string, JsonValue>, turnContexts: TurnContextRecord[]) => {
    const payload = asObject(parsed.payload);
    if (!payload) {
        return;
    }

    turnContexts.push({
        payload,
        timestamp: asString(parsed.timestamp),
    });
};

export const parseCodexTranscriptRecord = (
    parsed: Record<string, JsonValue>,
    sequence = 0,
    includeRaw = false,
): ThreadEvent | null => {
    const payload = asObject(parsed.payload);
    if (!payload) {
        return null;
    }

    const payloadType = asString(payload.type);
    const timestamp = asString(parsed.timestamp);

    if (parsed.type === 'event_msg') {
        return buildEventMessage(payload, payloadType, includeRaw ? parsed : {}, sequence, timestamp);
    }

    if (parsed.type !== 'response_item') {
        return null;
    }

    return buildResponseItemEvent(payload, payloadType, includeRaw ? parsed : {}, sequence, timestamp);
};

const buildEventMessage = (
    payload: Record<string, JsonValue>,
    payloadType: string | null,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
) => {
    return buildSupplementalEvent(payload, payloadType, raw, sequence, timestamp);
};

const buildResponseItemEvent = (
    payload: Record<string, JsonValue>,
    payloadType: string | null,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
) => {
    if (payloadType === 'message') {
        return createMessageEvent(payload, raw, sequence, timestamp);
    }

    if (payloadType === 'user_message') {
        return createUserMessageEvent(payload, raw, sequence, timestamp);
    }

    if (payloadType === 'agent_message') {
        return createAgentMessageEvent(payload, raw, sequence, timestamp);
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
        return createToolCallEvent(payload, raw, sequence, timestamp, payloadType === 'custom_tool_call');
    }

    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
        return createToolOutputEvent(payload, raw, sequence, timestamp);
    }

    if (payloadType === 'reasoning') {
        return createReasoningEvent(payload, raw, sequence, timestamp);
    }

    return buildSupplementalEvent(payload, payloadType, raw, sequence, timestamp);
};

const buildSupplementalEvent = (
    payload: Record<string, JsonValue>,
    payloadType: string | null,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
) => {
    if (payloadType === 'token_count') {
        return createTokenCountEvent(payload, raw, sequence, timestamp);
    }

    if (payloadType === 'web_search_call' || payloadType === 'web_search_end') {
        return createWebSearchEvent(payload, raw, sequence, timestamp);
    }

    if (payloadType === 'task_started') {
        return createTaskStartedEvent(payload, raw, sequence, timestamp);
    }

    if (payloadType === 'task_complete') {
        return createTaskCompleteEvent(payload, raw, sequence, timestamp);
    }

    return null;
};

const createMessageEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): MessageEvent | null => {
    const role = asString(payload.role);
    const content = payload.content;
    const text = extractText(content);
    if (!role || content === undefined) {
        return null;
    }

    return {
        isHiddenByDefault: shouldHideCodexTranscriptText(role, text),
        kind: 'message',
        memoryCitation: null,
        model: asString(payload.model),
        phase: asString(payload.phase),
        raw,
        role,
        sequence,
        text,
        timestamp,
        variant: 'message',
    };
};

const createUserMessageEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): MessageEvent => {
    const text = stripCodexMemoryCitationBlocks(asString(payload.message) ?? '');
    return {
        isHiddenByDefault: shouldHideCodexTranscriptText('user', text),
        kind: 'message',
        memoryCitation: null,
        model: null,
        phase: null,
        raw,
        role: 'user',
        sequence,
        text,
        timestamp,
        variant: 'user_message',
    };
};

const createAgentMessageEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): MessageEvent => {
    const text = stripCodexMemoryCitationBlocks(asString(payload.message) ?? '');
    return {
        isHiddenByDefault: shouldHideCodexTranscriptText('assistant', text),
        kind: 'message',
        memoryCitation: payload.memory_citation ?? null,
        model: asString(payload.model),
        phase: asString(payload.phase),
        raw,
        role: 'assistant',
        sequence,
        text,
        timestamp,
        variant: 'agent_message',
    };
};

const createToolCallEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
    isCustomToolCall: boolean,
): ToolCallEvent => {
    const name = asString(payload.name) ?? 'unknown';
    const argumentsText = asString(isCustomToolCall ? payload.input : payload.arguments);
    const parsedArguments = isCustomToolCall
        ? { argumentsParseFailed: false, cmd: argumentsText, workdir: null }
        : parseExecCommandArguments(argumentsText);

    return {
        argumentsParseFailed: parsedArguments.argumentsParseFailed,
        argumentsText,
        callId: asString(payload.call_id),
        command: parsedArguments.cmd,
        kind: 'tool_call',
        name,
        raw,
        sequence,
        timestamp,
        workdir: parsedArguments.workdir,
    };
};

const createToolOutputEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): ToolOutputEvent => {
    const outputText = extractToolOutputText(payload.output);

    return {
        callId: asString(payload.call_id),
        exitCode: parseExitCode(outputText),
        kind: 'tool_output',
        outputText,
        raw,
        sequence,
        summary: formatToolOutputSummary(outputText),
        timestamp,
        wallTime: parseWallTime(outputText),
    };
};

const createReasoningEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): ReasoningEvent => {
    return {
        content: payload.content ?? null,
        hasEncryptedContent: Boolean(asString(payload.encrypted_content)),
        kind: 'reasoning',
        raw,
        sequence,
        summary: toStringArray(payload.summary),
        timestamp,
    };
};

const createTokenCountEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): TokenCountEvent => {
    return {
        info: payload.info ?? null,
        kind: 'token_count',
        rateLimits: payload.rate_limits ?? null,
        raw,
        sequence,
        timestamp,
    };
};

const createTaskStartedEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): TaskStartedEvent => {
    return {
        collaborationModeKind: asString(payload.collaboration_mode_kind),
        kind: 'task_started',
        modelContextWindow: asNumber(payload.model_context_window),
        raw,
        sequence,
        startedAt: asNumber(payload.started_at),
        timestamp,
        turnId: asString(payload.turn_id),
    };
};

const createTaskCompleteEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): TaskCompleteEvent => {
    return {
        completedAt: asNumber(payload.completed_at),
        durationMs: asNumber(payload.duration_ms),
        kind: 'task_complete',
        lastAgentMessage: asString(payload.last_agent_message),
        raw,
        sequence,
        timestamp,
        timeToFirstTokenMs: asNumber(payload.time_to_first_token_ms),
        turnId: asString(payload.turn_id),
    };
};

const createWebSearchEvent = (
    payload: Record<string, JsonValue>,
    raw: Record<string, JsonValue>,
    sequence: number,
    timestamp: string | null,
): WebSearchEvent => {
    const payloadType = asString(payload.type);

    return {
        action: payload.action ?? null,
        callId: asString(payload.call_id),
        kind: 'web_search',
        phase: payloadType === 'web_search_end' ? 'end' : 'call',
        query: asString(payload.query),
        raw,
        sequence,
        status: asString(payload.status),
        timestamp,
    };
};

const updateTranscriptStats = (stats: ThreadTranscriptStats, event: ThreadEvent) => {
    if (event.kind === 'message') {
        stats.messageCount += 1;
        if (event.role === 'assistant') {
            stats.assistantMessageCount += 1;
        }
        if (event.role === 'user') {
            stats.userMessageCount += 1;
        }
        if (event.phase === 'commentary') {
            stats.commentaryCount += 1;
        }
        if (event.phase === 'final_answer') {
            stats.finalAnswerCount += 1;
        }
        return;
    }

    if (event.kind === 'tool_call') {
        stats.toolCallCount += 1;
        if (event.name === 'exec' || event.name === 'exec_command') {
            stats.execCommandCount += 1;
        }
        return;
    }

    if (event.kind === 'tool_output') {
        stats.toolOutputCount += 1;
        return;
    }

    if (event.kind === 'web_search') {
        stats.webSearchEventCount += 1;
    }
};

const toStringArray = (value: JsonValue | undefined): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry));
};

const parseExitCode = (outputText: string): number | null => {
    const match = /Process exited with code (\d+)/u.exec(outputText);
    return match ? Number(match[1]) : null;
};

const parseWallTime = (outputText: string): string | null => {
    const match = /Wall time: ([^\n]+)/u.exec(outputText);
    return match?.[1] ?? null;
};

const formatToolOutputSummary = (outputText: string): string => {
    const lines = outputText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    return lines
        .filter((line) => {
            return (
                line.startsWith('Command: ') ||
                line.startsWith('Process exited with code ') ||
                line.startsWith('Wall time: ')
            );
        })
        .join('\n');
};

const parseExecCommandArguments = (argumentsText: string | null) => {
    if (!argumentsText) {
        return { argumentsParseFailed: false, cmd: null as string | null, workdir: null as string | null };
    }

    try {
        const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
        return {
            argumentsParseFailed: false,
            cmd: typeof parsed.cmd === 'string' ? parsed.cmd : null,
            workdir: typeof parsed.workdir === 'string' ? parsed.workdir : null,
        };
    } catch {
        return { argumentsParseFailed: true, cmd: null as string | null, workdir: null as string | null };
    }
};

const extractToolOutputText = (output: JsonValue | undefined): string => {
    if (typeof output === 'string') {
        return output;
    }

    if (!Array.isArray(output)) {
        return '';
    }

    return output
        .map((entry) => {
            const contentBlock = asObject(entry);
            return contentBlock ? asString(contentBlock.text) : null;
        })
        .filter((entry): entry is string => entry !== null)
        .join('\n');
};

const extractText = (content: JsonValue): string => {
    if (typeof content === 'string') {
        return stripCodexMemoryCitationBlocks(content);
    }

    if (Array.isArray(content)) {
        return stripCodexMemoryCitationBlocks(
            content
                .map((entry) => extractTextPart(entry))
                .filter(Boolean)
                .join('\n\n'),
        );
    }

    if (content && typeof content === 'object') {
        return stripCodexMemoryCitationBlocks(asString((content as Record<string, JsonValue>).text) ?? '');
    }

    return '';
};

export const stripCodexMemoryCitationBlocks = (text: string): string => {
    return stripCodexAppDirectiveLines(text.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gu, ''));
};

const extractTextPart = (entry: JsonValue): string => {
    const objectValue = asObject(entry);
    if (!objectValue) {
        return '';
    }

    const type = asString(objectValue.type);
    const text = asString(objectValue.text);

    if (type === 'input_image') {
        return '[Image attached]';
    }

    return text ?? '';
};

export const shouldHideCodexTranscriptText = (role: string, text: string) => {
    if (!text) {
        return true;
    }

    if (role === 'developer') {
        return true;
    }

    return (
        text.startsWith('# AGENTS.md instructions for ') ||
        text.startsWith('AGENTS.md instructions for ') ||
        text.startsWith('<permissions instructions>') ||
        text.startsWith('<app-context>') ||
        text.startsWith('<environment_context>') ||
        text.startsWith('<collaboration_mode>') ||
        text.startsWith('<skills_instructions>') ||
        text.startsWith('<plugins_instructions>') ||
        text.includes('Filesystem sandboxing defines which files can be read or written.')
    );
};
