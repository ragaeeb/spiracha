import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { CursorBubble, CursorThreadTranscript, CursorToolCall } from '@spiracha/lib/cursor-exporter-types';
import { getCursorTextBubblePhase, getFinalCursorAssistantTextBubbleIds } from '@spiracha/lib/cursor-transcript-phase';
import type { JsonValue } from '@spiracha/lib/shared';

const toTimestamp = (value: number | null): string | null => {
    if (value === null || !Number.isFinite(value)) {
        return null;
    }

    return new Date(value).toISOString();
};

const toolCallToJson = (toolCall: CursorToolCall | null): JsonValue => {
    if (!toolCall) {
        return null;
    }

    return {
        argumentsText: toolCall.argumentsText,
        callId: toolCall.callId,
        name: toolCall.name,
        resultText: toolCall.resultText,
        status: toolCall.status,
    };
};

const buildBubbleRaw = (
    bubble: CursorBubble,
    eventType: string,
    extra: Record<string, JsonValue> = {},
): Record<string, JsonValue> => ({
    bubbleId: bubble.bubbleId,
    createdAtMs: bubble.createdAtMs,
    eventType,
    kind: bubble.kind,
    source: 'cursor_bubble',
    text: bubble.text,
    thinking: bubble.thinking,
    toolCall: toolCallToJson(bubble.toolCall),
    ...extra,
});

const buildMessageEvent = (
    bubble: CursorBubble,
    sequence: number,
    role: 'assistant' | 'user',
    text: string,
    phase: string | null,
): ThreadEvent => ({
    isHiddenByDefault: false,
    kind: 'message',
    memoryCitation: null,
    model: null,
    phase,
    raw: buildBubbleRaw(bubble, phase === 'commentary' ? 'thinking' : 'message'),
    role,
    sequence,
    text,
    timestamp: toTimestamp(bubble.createdAtMs),
    variant: role === 'user' ? 'user_message' : 'agent_message',
});

const buildToolCallCommand = (toolCall: CursorToolCall): string => {
    if (!toolCall.argumentsText?.trim()) {
        return toolCall.name;
    }

    return `${toolCall.name}\n${toolCall.argumentsText}`;
};

const buildToolCallEvent = (bubble: CursorBubble, sequence: number, toolCall: CursorToolCall): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: toolCall.argumentsText,
    callId: toolCall.callId,
    command: buildToolCallCommand(toolCall),
    kind: 'tool_call',
    name: toolCall.name,
    raw: buildBubbleRaw(bubble, 'tool_call', {
        argumentsText: toolCall.argumentsText,
        callId: toolCall.callId,
        name: toolCall.name,
        status: toolCall.status,
    }),
    sequence,
    timestamp: toTimestamp(bubble.createdAtMs),
    workdir: null,
});

const buildToolOutputEvent = (bubble: CursorBubble, sequence: number, toolCall: CursorToolCall): ThreadEvent | null => {
    const outputText = toolCall.resultText?.trim();
    if (!outputText) {
        return null;
    }

    return {
        callId: toolCall.callId,
        exitCode: null,
        kind: 'tool_output',
        outputText,
        raw: buildBubbleRaw(bubble, 'tool_output', {
            callId: toolCall.callId,
            name: toolCall.name,
            resultText: outputText,
            status: toolCall.status,
        }),
        sequence,
        summary: outputText,
        timestamp: toTimestamp(bubble.createdAtMs),
        wallTime: null,
    };
};

const cursorBubbleToThreadEvents = (
    bubble: CursorBubble,
    bubbleIndex: number,
    finalAssistantTextBubbleIds: Set<string>,
): ThreadEvent[] => {
    if (bubble.kind !== 'assistant' && bubble.kind !== 'user') {
        return [];
    }

    const baseSequence = bubbleIndex * 10;
    const events: ThreadEvent[] = [];
    if (bubble.kind === 'assistant' && bubble.thinking?.trim()) {
        events.push(buildMessageEvent(bubble, baseSequence, 'assistant', bubble.thinking.trim(), 'commentary'));
    }

    if (bubble.text.trim()) {
        const phase = getCursorTextBubblePhase(bubble, finalAssistantTextBubbleIds);
        events.push(buildMessageEvent(bubble, baseSequence + 1, bubble.kind, bubble.text, phase));
    }

    if (bubble.kind === 'assistant' && bubble.toolCall) {
        events.push(buildToolCallEvent(bubble, baseSequence + 2, bubble.toolCall));
        const output = buildToolOutputEvent(bubble, baseSequence + 3, bubble.toolCall);
        if (output) {
            events.push(output);
        }
    }

    return events;
};

export const cursorTranscriptToThreadEvents = (transcript: CursorThreadTranscript): ThreadEvent[] => {
    const finalAssistantTextBubbleIds = getFinalCursorAssistantTextBubbleIds(transcript.bubbles);
    return transcript.bubbles.flatMap((bubble, index) =>
        cursorBubbleToThreadEvents(bubble, index, finalAssistantTextBubbleIds),
    );
};

const updateMessageStats = (stats: ThreadTranscriptStats, event: Extract<ThreadEvent, { kind: 'message' }>) => {
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
};

const updateCursorStats = (stats: ThreadTranscriptStats, event: ThreadEvent) => {
    switch (event.kind) {
        case 'message':
            updateMessageStats(stats, event);
            break;
        case 'tool_call':
            stats.toolCallCount += 1;
            break;
        case 'tool_output':
            stats.toolOutputCount += 1;
            break;
        case 'web_search':
            stats.webSearchEventCount += 1;
            break;
        default:
            break;
    }
};

export const getCursorThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    const stats: ThreadTranscriptStats = {
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

    for (const event of events) {
        updateCursorStats(stats, event);
    }

    return stats;
};
