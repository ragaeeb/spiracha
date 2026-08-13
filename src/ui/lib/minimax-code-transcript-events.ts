import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type {
    MiniMaxCodeSessionTranscript,
    MiniMaxCodeToolCall,
    MiniMaxCodeTranscriptMessage,
} from '@spiracha/lib/minimax-code-exporter-types';
import { getMiniMaxCodeMessagePhase } from '@spiracha/lib/minimax-code-transcript-phase';
import type { JsonValue } from '@spiracha/lib/shared';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const toTimestamp = (value: number | null): string | null => {
    return value === null || !Number.isFinite(value) ? null : new Date(value).toISOString();
};

const buildRaw = (message: MiniMaxCodeTranscriptMessage, eventType: string): Record<string, JsonValue> => ({
    eventType,
    messageId: message.messageId,
    messageType: message.messageType,
    role: message.role,
    source: 'minimax_code_snapshot',
    ...message.raw,
});

const buildMessageEvent = (message: MiniMaxCodeTranscriptMessage, sequence: number, text: string): ThreadEvent => ({
    isHiddenByDefault: message.role !== 'assistant' && message.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: null,
    phase: getMiniMaxCodeMessagePhase(message),
    raw: buildRaw(message, 'message'),
    role: message.role,
    sequence,
    text,
    timestamp: toTimestamp(message.createdAtMs),
    variant: message.role === 'user' ? 'user_message' : message.role === 'assistant' ? 'agent_message' : 'message',
});

const buildReasoningEvent = (message: MiniMaxCodeTranscriptMessage, sequence: number): ThreadEvent | null => {
    const text = message.reasoning?.trim();
    if (!text) {
        return null;
    }
    return {
        content: text,
        hasEncryptedContent: false,
        kind: 'reasoning',
        raw: buildRaw(message, 'reasoning'),
        sequence,
        summary: [text],
        timestamp: toTimestamp(message.createdAtMs),
    };
};

const buildToolCallEvent = (
    message: MiniMaxCodeTranscriptMessage,
    toolCall: MiniMaxCodeToolCall,
    sequence: number,
    worktree: string,
): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: toolCall.argumentsText,
    callId: toolCall.callId,
    command: toolCall.command ?? [toolCall.toolName, toolCall.argumentsText].filter(Boolean).join('\n'),
    kind: 'tool_call',
    name: toolCall.toolName,
    raw: {
        ...buildRaw(message, 'tool_call'),
        ...toolCall.raw,
        status: toolCall.status,
    },
    sequence,
    timestamp: toTimestamp(message.createdAtMs),
    workdir: worktree,
});

const buildToolOutputEvent = (
    message: MiniMaxCodeTranscriptMessage,
    toolCall: MiniMaxCodeToolCall,
    sequence: number,
): ThreadEvent | null => {
    const outputText = toolCall.outputText?.trim();
    if (!outputText) {
        return null;
    }
    return {
        callId: toolCall.callId,
        exitCode: toolCall.status === 'failed' ? 1 : toolCall.status === 'succeeded' ? 0 : null,
        kind: 'tool_output',
        outputText,
        raw: {
            ...buildRaw(message, 'tool_output'),
            ...toolCall.raw,
            status: toolCall.status,
        },
        sequence,
        summary: outputText,
        timestamp: toTimestamp(message.createdAtMs),
        wallTime: null,
    };
};

const messageToEvents = (
    message: MiniMaxCodeTranscriptMessage,
    startingSequence: number,
    worktree: string,
): ThreadEvent[] => {
    const events: ThreadEvent[] = [];
    const reasoning = buildReasoningEvent(message, startingSequence + events.length);
    if (reasoning) {
        events.push(reasoning);
    }

    const text = message.content?.trim();
    if (text) {
        events.push(buildMessageEvent(message, startingSequence + events.length, text));
    }

    for (const toolCall of message.toolCalls) {
        events.push(buildToolCallEvent(message, toolCall, startingSequence + events.length, worktree));
        const output = buildToolOutputEvent(message, toolCall, startingSequence + events.length);
        if (output) {
            events.push(output);
        }
    }
    return events;
};

export const miniMaxCodeTranscriptToThreadEvents = (transcript: MiniMaxCodeSessionTranscript): ThreadEvent[] => {
    const events: ThreadEvent[] = [];
    for (const message of transcript.messages) {
        events.push(...messageToEvents(message, events.length, transcript.session.worktree));
    }
    return events;
};

export const getMiniMaxCodeThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    return getThreadTranscriptStats(events);
};
