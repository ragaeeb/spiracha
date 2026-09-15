import type { JsonValue } from '../shared-text';

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
