import type {
    MiniMaxCodeSessionSummary,
    MiniMaxCodeSessionTranscript,
    MiniMaxCodeToolCall,
    MiniMaxCodeToolStatus,
    MiniMaxCodeTranscriptMessage,
} from './minimax-code-exporter-types';
import { getPortablePathBasename } from './portable-path';
import { asBoolean, asNumber, asObject, asString, cleanInlineTitle, type JsonValue } from './shared-text';

export const WORKSPACE_KEY_PREFIX = 'workspace:';

export type ReadSnapshotOptions = {
    includeRawPayloads?: boolean;
};

export type SessionStats = {
    assistantMessageCount: number;
    messageCount: number;
    reasoningCount: number;
    renderablePartCount: number;
    toolCallCount: number;
    toolResultCount: number;
    userMessageCount: number;
};

export const getWorkspaceKey = (worktree: string): string => `${WORKSPACE_KEY_PREFIX}${encodeURIComponent(worktree)}`;

export const getWorkspaceLabel = (worktree: string): string => getPortablePathBasename(worktree) || worktree;

export const parseJsonValue = (value: string | null): JsonValue | null => {
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

export const createNewMessageParsingContext = (includeRawPayloads: boolean): NewMessageParsingContext => ({
    includeRawPayloads,
    pendingToolResults: new Map(),
    toolCallsById: new Map(),
});

export const consumeNewMessageRow = (
    row: Record<string, JsonValue>,
    context: NewMessageParsingContext,
    messages: MiniMaxCodeTranscriptMessage[],
): void => {
    const message = asObject(row.message ?? null);
    if (!message) {
        return;
    }

    if (message.role === 'toolResult') {
        consumeNewToolResult(message, context);
        return;
    }

    const parsedMessage = parseNewTranscriptMessage(row, message, context);
    if (parsedMessage) {
        messages.push(parsedMessage);
    }
};

export const parseMiniMaxCodeMessageRows = (
    rows: readonly Record<string, JsonValue>[],
    includeRawPayloads = true,
): MiniMaxCodeTranscriptMessage[] => {
    const messages: MiniMaxCodeTranscriptMessage[] = [];
    const context = createNewMessageParsingContext(includeRawPayloads);

    for (const row of rows) {
        consumeNewMessageRow(row, context, messages);
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

const getMiniMaxWorkspaceFields = (
    worktree: string,
): Pick<MiniMaxCodeSessionSummary, 'workspaceKey' | 'workspaceLabel'> =>
    worktree
        ? { workspaceKey: getWorkspaceKey(worktree), workspaceLabel: getWorkspaceLabel(worktree) }
        : { workspaceKey: '', workspaceLabel: '' };

const getLatestActivityAtMs = (
    record: Record<string, JsonValue>,
    messages: MiniMaxCodeTranscriptMessage[],
): number | null => {
    return messages.reduce<number | null>(
        (latest, message) => {
            if (message.createdAtMs === null) {
                return latest;
            }
            return latest === null ? message.createdAtMs : Math.max(latest, message.createdAtMs);
        },
        asNumber(record.updatedAtMs ?? null),
    );
};

const toSessionSummary = (
    snapshotPath: string,
    record: Record<string, JsonValue>,
    sessionId: string,
    messages: MiniMaxCodeTranscriptMessage[],
    piHistory?: JsonValue,
    options: { allowMissingWorktree?: boolean; sessionDir: string } = { sessionDir: '<payload>' },
): MiniMaxCodeSessionSummary | null => {
    const worktree = asString(record.workspaceDir ?? null)?.trim() ?? '';
    if (!worktree && !options.allowMissingWorktree) {
        return null;
    }

    const stats = getSessionStats(messages);
    const title = cleanInlineTitle(asString(record.title ?? null) || sessionId) || sessionId;
    const workspaceFields = getMiniMaxWorkspaceFields(worktree);
    return {
        agentName: asString(record.agentName ?? null),
        appMode: asString(record.appMode ?? null),
        archived: asBoolean(record.archived ?? null),
        ...stats,
        createdAtMs: asNumber(record.createdAtMs ?? null),
        currentModelId: getSessionModelId(record, piHistory),
        currentModelVariant: asString(record.effectiveModelVariant ?? null),
        lastActiveAtMs: getLatestActivityAtMs(record, messages),
        runtime: asString(record.runtime ?? null),
        sessionDir: options.sessionDir,
        sessionId,
        sessionType: asString(record.sessionType ?? null),
        snapshotPath,
        status: asString(record.status ?? null),
        title,
        ...workspaceFields,
        worktree,
    };
};

export const createMiniMaxCodeSessionTranscript = ({
    allowMissingWorktree = false,
    messages,
    piHistory,
    record,
    sessionId,
    snapshotPath,
    sessionDir = '<payload>',
}: {
    allowMissingWorktree?: boolean;
    messages: MiniMaxCodeTranscriptMessage[];
    piHistory?: JsonValue;
    record: Record<string, JsonValue>;
    sessionId: string;
    snapshotPath: string;
    sessionDir?: string;
}): MiniMaxCodeSessionTranscript | null => {
    const session = toSessionSummary(snapshotPath, record, sessionId, messages, piHistory, {
        allowMissingWorktree,
        sessionDir,
    });
    if (!session) {
        return null;
    }

    return {
        messages,
        renderablePartCount: session.renderablePartCount,
        session,
    };
};

export const parseMiniMaxCodeSnapshotPayload = (
    value: JsonValue,
    snapshotPath = '<payload>/snapshot.json',
    options: ReadSnapshotOptions & { sessionDir?: string } = {},
): MiniMaxCodeSessionTranscript | null => {
    const root = asObject(value);
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
    const transcript = createMiniMaxCodeSessionTranscript({
        messages,
        piHistory: root.piHistory,
        record,
        sessionDir: options.sessionDir,
        sessionId,
        snapshotPath,
    });
    if (!transcript) {
        return null;
    }

    return {
        ...transcript,
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
    };
};
