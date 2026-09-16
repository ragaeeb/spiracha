import type { JsonValue } from '../shared-text';
import type { ConversationMessage } from './types';

type BaseThreadEvent = {
    kind:
        | 'message'
        | 'reasoning'
        | 'task_complete'
        | 'task_started'
        | 'token_count'
        | 'tool_call'
        | 'tool_output'
        | 'web_search';
    raw: Record<string, JsonValue>;
    sequence: number;
    timestamp: string | null;
};

export type MessageEvent = BaseThreadEvent & {
    kind: 'message';
    isHiddenByDefault: boolean;
    memoryCitation: JsonValue | null;
    model: string | null;
    phase: string | null;
    role: string;
    text: string;
    variant: 'agent_message' | 'message' | 'user_message';
};

export type ToolCallEvent = BaseThreadEvent & {
    argumentsText: string | null;
    argumentsParseFailed: boolean;
    callId: string | null;
    command: string | null;
    kind: 'tool_call';
    name: string;
    workdir: string | null;
};

export type ToolOutputEvent = BaseThreadEvent & {
    callId: string | null;
    exitCode: number | null;
    kind: 'tool_output';
    outputText: string;
    summary: string;
    wallTime: string | null;
};

export type ReasoningEvent = BaseThreadEvent & {
    content: JsonValue | null;
    hasEncryptedContent: boolean;
    kind: 'reasoning';
    summary: string[];
};

export type TokenCountEvent = BaseThreadEvent & {
    info: JsonValue | null;
    kind: 'token_count';
    rateLimits: JsonValue | null;
};

export type TaskStartedEvent = BaseThreadEvent & {
    collaborationModeKind: string | null;
    kind: 'task_started';
    modelContextWindow: number | null;
    startedAt: number | null;
    turnId: string | null;
};

export type TaskCompleteEvent = BaseThreadEvent & {
    completedAt: number | null;
    durationMs: number | null;
    kind: 'task_complete';
    lastAgentMessage: string | null;
    timeToFirstTokenMs: number | null;
    turnId: string | null;
};

export type WebSearchEvent = BaseThreadEvent & {
    action: JsonValue | null;
    callId: string | null;
    kind: 'web_search';
    phase: 'call' | 'end';
    query: string | null;
    status: string | null;
};

export type ThreadEvent =
    | MessageEvent
    | ReasoningEvent
    | TaskCompleteEvent
    | TaskStartedEvent
    | TokenCountEvent
    | ToolCallEvent
    | ToolOutputEvent
    | WebSearchEvent;

export type ThreadTranscriptStats = {
    assistantMessageCount: number;
    commentaryCount: number;
    execCommandCount: number;
    finalAnswerCount: number;
    messageCount: number;
    modelNames: string[];
    toolCallCount: number;
    toolOutputCount: number;
    userMessageCount: number;
    webSearchEventCount: number;
};

export type TranscriptEventFilters = {
    showCommentary: boolean;
    showExtraEvents: boolean;
    showToolCalls: boolean;
    showUserMessages: boolean;
};

const isCommentaryMessage = (event: ThreadEvent) =>
    event.kind === 'message' && event.role === 'assistant' && event.phase === 'commentary';

export const shouldShowTranscriptEvent = (event: ThreadEvent, filters: TranscriptEventFilters) => {
    if (isCommentaryMessage(event) && !filters.showCommentary) {
        return false;
    }

    if (event.kind === 'message') {
        if (event.role === 'user' && !filters.showUserMessages) {
            return false;
        }

        return !event.isHiddenByDefault || filters.showExtraEvents;
    }

    if (event.kind === 'tool_call' || event.kind === 'tool_output') {
        return filters.showToolCalls;
    }

    return filters.showExtraEvents;
};

export const projectDisplayText = (text: string, maxCharacters: number) => {
    const limit = Math.max(0, maxCharacters);
    if (text.length <= limit) {
        return { originalCharacters: text.length, previewText: text, truncated: false };
    }
    return {
        originalCharacters: text.length,
        previewText: text.slice(0, limit),
        truncated: true,
    };
};

export type CanonicalThreadEventOptions = {
    modelFrom?: (message: ConversationMessage) => string | null;
    source?: string;
};

const toTimestamp = (createdAtMs: number | null) => (createdAtMs === null ? null : new Date(createdAtMs).toISOString());

const messageRaw = (message: ConversationMessage, source: string) => ({
    id: message.id,
    phase: message.phase,
    role: message.role,
    source,
    text: message.text,
});

const toReasoningEvent = (
    message: ConversationMessage,
    raw: ReturnType<typeof messageRaw>,
    sequence: number,
    timestamp: string | null,
): ThreadEvent => ({
    content: message.text,
    hasEncryptedContent: false,
    kind: 'reasoning',
    raw,
    sequence,
    summary: [message.text],
    timestamp,
});

const toToolCallEvent = (
    message: ConversationMessage,
    raw: ReturnType<typeof messageRaw>,
    sequence: number,
    timestamp: string | null,
): ThreadEvent => {
    const name = message.toolEvidence?.name ?? 'unknown';
    return {
        argumentsParseFailed: false,
        argumentsText: message.toolEvidence?.inputText ?? null,
        callId: message.toolEvidence?.callId ?? null,
        command: message.toolEvidence?.command ?? name,
        kind: 'tool_call',
        name,
        raw,
        sequence,
        timestamp,
        workdir: message.toolEvidence?.workdir ?? null,
    };
};

const toToolOutputEvent = (
    message: ConversationMessage,
    raw: ReturnType<typeof messageRaw>,
    sequence: number,
    timestamp: string | null,
): ThreadEvent => {
    const outputText = message.toolEvidence?.outputText ?? message.text;
    return {
        callId: message.toolEvidence?.callId ?? null,
        exitCode: message.toolEvidence?.exitCode ?? null,
        kind: 'tool_output',
        outputText,
        raw,
        sequence,
        summary: outputText,
        timestamp,
        wallTime: null,
    };
};

const toMessageEvent = (
    message: ConversationMessage,
    raw: ReturnType<typeof messageRaw>,
    sequence: number,
    timestamp: string | null,
    modelFrom: CanonicalThreadEventOptions['modelFrom'],
): ThreadEvent => ({
    isHiddenByDefault: message.role !== 'assistant' && message.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: modelFrom?.(message) ?? message.model ?? null,
    phase: message.phase === 'unknown' ? null : message.phase,
    raw,
    role: message.role,
    sequence,
    text: message.text,
    timestamp,
    variant: message.role === 'user' ? 'user_message' : message.role === 'assistant' ? 'agent_message' : 'message',
});

export const canonicalMessagesToThreadEvents = (
    messages: ConversationMessage[],
    options: CanonicalThreadEventOptions = {},
): ThreadEvent[] =>
    messages.map((message, sequence) => {
        const timestamp = toTimestamp(message.createdAtMs);
        const raw = messageRaw(message, options.source ?? 'canonical');
        if (message.phase === 'reasoning') {
            return toReasoningEvent(message, raw, sequence, timestamp);
        }
        if (message.phase === 'tool_call') {
            return toToolCallEvent(message, raw, sequence, timestamp);
        }
        if (message.phase === 'tool_output') {
            return toToolOutputEvent(message, raw, sequence, timestamp);
        }
        return toMessageEvent(message, raw, sequence, timestamp, options.modelFrom);
    });
