import type {
    FxSessionSummary,
    FxSessionTranscript,
    FxToolCall,
    FxToolStatus,
    FxTranscriptMessage,
} from './fx-exporter-types';
import { getPortablePathBasename } from './portable-path';
import { asNumber, asObject, asString, cleanInlineTitle, type JsonValue } from './shared-text';

export const WORKSPACE_KEY_PREFIX = 'workspace:';

export type FxSessionRecord = {
    conversationLanguage: string | null;
    createdAtMs: number | null;
    currentModelId: string | null;
    currentModelVariant: string | null;
    lastActiveAtMs: number | null;
    sessionId: string;
    title: string;
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    worktree: string;
};

export type FxTurnSource = {
    createdAtMs: number | null;
    finishReason: 'in_progress' | 'stop';
    raw: Record<string, JsonValue>;
    turn: Record<string, JsonValue>;
};

type SessionStats = Pick<
    FxSessionSummary,
    | 'assistantMessageCount'
    | 'messageCount'
    | 'reasoningCount'
    | 'renderablePartCount'
    | 'toolCallCount'
    | 'toolResultCount'
    | 'userMessageCount'
>;

export const getWorkspaceKey = (worktree: string): string => `${WORKSPACE_KEY_PREFIX}${encodeURIComponent(worktree)}`;

export const firstString = (...values: (JsonValue | undefined)[]): string | null => {
    for (const value of values) {
        const text = asString(value ?? null)?.trim();
        if (text) {
            return text;
        }
    }
    return null;
};

const firstNumber = (...values: (JsonValue | undefined)[]): number | null => {
    for (const value of values) {
        const number = asNumber(value ?? null);
        if (number !== null) {
            return number;
        }
    }
    return null;
};

export const objectArray = (value: JsonValue | undefined): Record<string, JsonValue>[] =>
    Array.isArray(value)
        ? value.flatMap((item) => {
              const object = asObject(item);
              return object ? [object] : [];
          })
        : [];

export const parseFxSessionRecordPayload = ({
    checkpoint,
    display,
    indexRecord = {},
    session,
    sessionId,
    allowMissingWorktree = false,
}: {
    checkpoint?: Record<string, JsonValue> | null;
    display?: Record<string, JsonValue> | null;
    indexRecord?: Record<string, JsonValue>;
    session: Record<string, JsonValue>;
    sessionId: string;
    allowMissingWorktree?: boolean;
}): FxSessionRecord | null => {
    const state = asObject(checkpoint?.state ?? null);
    const preferences = asObject(session.preferences ?? null) ?? asObject(state?.preferences ?? null);
    const worktree = firstString(indexRecord.workspace_root, session.workspace_root, state?.workspace_root) ?? '';
    if (!worktree && !allowMissingWorktree) {
        return null;
    }
    const rawTitle = firstString(display?.title, indexRecord.title, indexRecord.preview);
    return {
        conversationLanguage: firstString(indexRecord.conversation_language, session.conversation_language),
        createdAtMs: firstNumber(indexRecord.created_at_ms, session.created_at_ms, state?.created_at_ms),
        currentModelId: firstString(preferences?.model),
        currentModelVariant: firstString(preferences?.effort),
        lastActiveAtMs: firstNumber(indexRecord.updated_at_ms, session.updated_at_ms, state?.updated_at_ms),
        sessionId,
        title: cleanInlineTitle(rawTitle ?? sessionId) || sessionId,
        totalInputTokens: firstNumber(session.total_input_tokens, state?.total_input_tokens),
        totalOutputTokens: firstNumber(session.total_output_tokens, state?.total_output_tokens),
        worktree,
    };
};

const normalizeToolStatus = (value: JsonValue | undefined): FxToolStatus => {
    const status = asString(value ?? null)?.toLowerCase();
    if (status && /(?:success|complete|done|finish)/u.test(status)) {
        return 'succeeded';
    }
    if (status && /(?:fail|error|reject|cancel)/u.test(status)) {
        return 'failed';
    }
    return 'unknown';
};

const commandFromArguments = (argumentsText: string | null): string | null => {
    if (!argumentsText) {
        return null;
    }
    try {
        return asString(asObject(JSON.parse(argumentsText) as JsonValue)?.command ?? null)?.trim() || null;
    } catch {
        return null;
    }
};

type FxToolCallInput = {
    argumentsText: string | null;
    call: Record<string, JsonValue>;
    result?: Record<string, JsonValue>;
};

export const getToolCallInputs = (step: Record<string, JsonValue>): FxToolCallInput[] => {
    const results = Array.isArray(step.tool_results)
        ? step.tool_results.flatMap((value) => {
              const result = asObject(value);
              return result ? [result] : [];
          })
        : [];
    const resultsById = new Map(
        results.flatMap((result) => {
            const id = asString(result.tool_call_id ?? null)?.trim();
            return id ? [[id, result] as const] : [];
        }),
    );
    if (!Array.isArray(step.tool_calls)) {
        return [];
    }
    return step.tool_calls.flatMap((value) => {
        const call = asObject(value);
        if (!call) {
            return [];
        }
        const callId = asString(call.id ?? null)?.trim() || null;
        const argumentsText = asString(call.arguments_json ?? null)?.trim() || null;
        return [{ argumentsText, call, result: callId ? resultsById.get(callId) : undefined }];
    });
};

export const createFxToolCall = (
    input: FxToolCallInput,
    includeRawPayloads: boolean,
    outputText: string | null,
): FxToolCall => {
    const callId = asString(input.call.id ?? null)?.trim() || null;
    return {
        argumentsText: input.argumentsText,
        callId,
        command: commandFromArguments(input.argumentsText),
        outputText,
        raw: includeRawPayloads ? { call: input.call, ...(input.result ? { result: input.result } : {}) } : {},
        status: normalizeToolStatus(input.result?.status),
        toolName: asString(input.call.name ?? null)?.trim() || 'unknown',
    };
};

const parsePayloadToolCalls = (
    step: Record<string, JsonValue>,
    toolResults: Record<string, JsonValue>,
    includeRawPayloads: boolean,
): FxToolCall[] => {
    return getToolCallInputs(step).map((input) => {
        const handle = input.result ? asString(input.result.output_handle ?? null)?.trim() : null;
        const externalOutput = handle ? asString(toolResults[handle] ?? null)?.trim() || null : null;
        const outputText =
            externalOutput ??
            (input.result
                ? asString(input.result.output ?? null)?.trim() ||
                  asString(input.result.preview ?? null)?.trim() ||
                  null
                : null);
        return createFxToolCall(input, includeRawPayloads, outputText);
    });
};

export const createMessage = (
    input: Pick<
        FxTranscriptMessage,
        'content' | 'createdAtMs' | 'finishReason' | 'messageId' | 'role' | 'toolCalls'
    > & {
        raw: Record<string, JsonValue>;
    },
): FxTranscriptMessage => ({
    ...input,
    messageType: input.role === 'user' ? 1 : 2,
    reasoning: null,
    thinkingDurationMs: null,
});

export const parseUserMessage = (
    source: FxTurnSource,
    turnIndex: number,
    includeRawPayloads: boolean,
): FxTranscriptMessage | null => {
    const user = asObject(source.turn.user ?? null);
    const content = firstString(user?.text);
    return content
        ? createMessage({
              content,
              createdAtMs: source.createdAtMs,
              finishReason: null,
              messageId: `turn:${turnIndex}:user`,
              raw: includeRawPayloads ? { user: user ?? {} } : {},
              role: 'user',
              toolCalls: [],
          })
        : null;
};

export const parseAssistantMessage = (
    source: FxTurnSource,
    turnIndex: number,
    includeRawPayloads: boolean,
): FxTranscriptMessage | null => {
    const content = firstString(source.turn.assistant);
    return content
        ? createMessage({
              content,
              createdAtMs: source.createdAtMs,
              finishReason: source.finishReason,
              messageId: `turn:${turnIndex}:assistant`,
              raw: includeRawPayloads ? source.raw : {},
              role: 'assistant',
              toolCalls: [],
          })
        : null;
};

export const parseFxPayloadMessages = (
    sources: readonly FxTurnSource[],
    toolResults: Record<string, JsonValue> = {},
    includeRawPayloads = true,
): FxTranscriptMessage[] => {
    return sources.flatMap((source, turnIndex) => {
        const execution = asObject(source.turn.execution ?? null);
        const stepMessages = objectArray(execution?.tool_steps).flatMap((step, stepIndex) => {
            const content = firstString(step.assistant);
            const toolCalls = parsePayloadToolCalls(step, toolResults, includeRawPayloads);
            return content || toolCalls.length > 0
                ? [
                      createMessage({
                          content,
                          createdAtMs: source.createdAtMs,
                          finishReason: 'toolUse',
                          messageId: `turn:${turnIndex}:step:${stepIndex}`,
                          raw: includeRawPayloads ? step : {},
                          role: 'assistant',
                          toolCalls,
                      }),
                  ]
                : [];
        });
        return [
            parseUserMessage(source, turnIndex, includeRawPayloads),
            ...stepMessages,
            parseAssistantMessage(source, turnIndex, includeRawPayloads),
        ].flatMap((message) => (message ? [message] : []));
    });
};

const recoveryToTurn = (checkpoint: Record<string, JsonValue>): Record<string, JsonValue> => ({
    assistant: checkpoint.assistant_source ?? null,
    execution: checkpoint.execution ?? null,
    kind: 'assistant',
    user: checkpoint.user ?? null,
});

const getCheckpointTurnSources = (state: Record<string, JsonValue> | null): FxTurnSource[] =>
    objectArray(state?.history).map((turn) => ({
        createdAtMs: firstNumber(state?.created_at_ms),
        finishReason: 'stop',
        raw: turn,
        turn,
    }));

type PendingTurn = { checkpoint: Record<string, JsonValue> | null; createdAtMs: number | null };

type FxTurnSourceParseState = {
    pending: PendingTurn;
    sources: FxTurnSource[];
    throughSeq: number;
};

const updatePendingTurn = (
    event: Record<string, JsonValue>,
    pending: PendingTurn,
    sources: FxTurnSource[],
): PendingTurn => {
    const kind = firstString(event.kind);
    const payload = asObject(event.payload ?? null);
    if (kind === 'recovery_checkpoint_set') {
        return {
            checkpoint: asObject(payload?.checkpoint ?? null),
            createdAtMs: pending.createdAtMs ?? firstNumber(event.timestamp_ms),
        };
    }
    const committedTurn = kind === 'history_turn_committed' ? asObject(payload?.turn ?? null) : null;
    if (!committedTurn) {
        return pending;
    }
    sources.push({
        createdAtMs: pending.createdAtMs ?? firstNumber(event.timestamp_ms),
        finishReason: 'stop',
        raw: committedTurn,
        turn: committedTurn,
    });
    return { checkpoint: null, createdAtMs: null };
};

export const parseFxPayloadTurnSources = (
    checkpoint: Record<string, JsonValue> | null,
    events: readonly Record<string, JsonValue>[] = [],
    options: { defaultThroughSeq?: number } = {},
): FxTurnSource[] => {
    const state = createFxTurnSourceParseState(checkpoint, options.defaultThroughSeq ?? 0);
    for (const event of events) {
        consumeFxTurnSourceEvent(event, state);
    }
    return finalizeFxTurnSourceParse(state);
};

export const createFxTurnSourceParseState = (
    checkpoint: Record<string, JsonValue> | null,
    defaultThroughSeq: number,
): FxTurnSourceParseState => ({
    pending: { checkpoint: null, createdAtMs: null },
    sources: getCheckpointTurnSources(asObject(checkpoint?.state ?? null)),
    throughSeq: firstNumber(checkpoint?.through_seq) ?? defaultThroughSeq,
});

export const consumeFxTurnSourceEvent = (event: Record<string, JsonValue>, state: FxTurnSourceParseState): void => {
    const seq = firstNumber(event.seq) ?? 0;
    if (seq <= state.throughSeq) {
        return;
    }
    state.pending = updatePendingTurn(event, state.pending, state.sources);
};

export const finalizeFxTurnSourceParse = (state: FxTurnSourceParseState): FxTurnSource[] => {
    if (state.pending.checkpoint) {
        state.sources.push({
            createdAtMs: state.pending.createdAtMs,
            finishReason: 'in_progress',
            raw: state.pending.checkpoint,
            turn: recoveryToTurn(state.pending.checkpoint),
        });
    }
    return state.sources;
};

const getSessionStats = (messages: FxTranscriptMessage[]): SessionStats => {
    const toolCalls = messages.flatMap((message) => message.toolCalls);
    const reasoningCount = messages.filter((message) => Boolean(message.reasoning)).length;
    const toolResultCount = toolCalls.filter((toolCall) => Boolean(toolCall.outputText)).length;
    return {
        assistantMessageCount: messages.filter((message) => message.role === 'assistant').length,
        messageCount: messages.length,
        reasoningCount,
        renderablePartCount:
            messages.filter((message) => Boolean(message.content)).length +
            reasoningCount +
            toolCalls.length +
            toolResultCount,
        toolCallCount: toolCalls.length,
        toolResultCount,
        userMessageCount: messages.filter((message) => message.role === 'user').length,
    };
};

export const toSessionSummary = (
    sessionDir: string,
    record: FxSessionRecord,
    messages: FxTranscriptMessage[],
): FxSessionSummary => {
    const stats = getSessionStats(messages);
    return {
        ...stats,
        conversationLanguage: record.conversationLanguage,
        createdAtMs: record.createdAtMs,
        currentModelId: record.currentModelId,
        currentModelVariant: record.currentModelVariant,
        lastActiveAtMs: record.lastActiveAtMs,
        sessionDir,
        sessionId: record.sessionId,
        status: messages.at(-1)?.finishReason === 'in_progress' ? 'in_progress' : 'complete',
        title: record.title,
        totalInputTokens: record.totalInputTokens,
        totalOutputTokens: record.totalOutputTokens,
        workspaceKey: getWorkspaceKey(record.worktree),
        workspaceLabel: getPortablePathBasename(record.worktree) || record.worktree,
        worktree: record.worktree,
    };
};

export const createFxSessionTranscript = ({
    messages,
    record,
    sessionDir = `<payload>/sessions/${record.sessionId}`,
}: {
    sessionDir?: string;
    messages: FxTranscriptMessage[];
    record: FxSessionRecord;
}): FxSessionTranscript => {
    const session = toSessionSummary(sessionDir, record, messages);
    return {
        messages,
        renderablePartCount: session.renderablePartCount,
        session,
    };
};
