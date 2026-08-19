import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { FxSessionTranscript, FxToolCall, FxTranscriptMessage } from '@spiracha/lib/fx-exporter-types';
import { getFxMessagePhase } from '@spiracha/lib/fx-transcript-phase';
import type { JsonValue } from '@spiracha/lib/shared';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const toTimestamp = (value: number | null): string | null =>
    value === null || !Number.isFinite(value) ? null : new Date(value).toISOString();

const buildRaw = (message: FxTranscriptMessage, eventType: string): Record<string, JsonValue> => ({
    eventType,
    messageId: message.messageId,
    messageType: message.messageType,
    role: message.role,
    source: 'fx_event_log',
    ...message.raw,
});

const buildMessageEvent = (message: FxTranscriptMessage, sequence: number, text: string): ThreadEvent => ({
    isHiddenByDefault: message.role !== 'assistant' && message.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: null,
    phase: getFxMessagePhase(message),
    raw: buildRaw(message, 'message'),
    role: message.role,
    sequence,
    text,
    timestamp: toTimestamp(message.createdAtMs),
    variant: message.role === 'user' ? 'user_message' : message.role === 'assistant' ? 'agent_message' : 'message',
});

const buildToolCallEvent = (
    message: FxTranscriptMessage,
    toolCall: FxToolCall,
    sequence: number,
    worktree: string,
): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: toolCall.argumentsText,
    callId: toolCall.callId,
    command: toolCall.command ?? [toolCall.toolName, toolCall.argumentsText].filter(Boolean).join('\n'),
    kind: 'tool_call',
    name: toolCall.toolName,
    raw: { ...buildRaw(message, 'tool_call'), ...toolCall.raw, status: toolCall.status },
    sequence,
    timestamp: toTimestamp(message.createdAtMs),
    workdir: worktree,
});

const buildToolOutputEvent = (
    message: FxTranscriptMessage,
    toolCall: FxToolCall,
    sequence: number,
): ThreadEvent | null => {
    const outputText = toolCall.outputText?.trim();
    return outputText
        ? {
              callId: toolCall.callId,
              exitCode: toolCall.status === 'failed' ? 1 : toolCall.status === 'succeeded' ? 0 : null,
              kind: 'tool_output',
              outputText,
              raw: { ...buildRaw(message, 'tool_output'), ...toolCall.raw, status: toolCall.status },
              sequence,
              summary: outputText,
              timestamp: toTimestamp(message.createdAtMs),
              wallTime: null,
          }
        : null;
};

export const fxTranscriptToThreadEvents = (transcript: FxSessionTranscript): ThreadEvent[] => {
    const events: ThreadEvent[] = [];
    for (const message of transcript.messages) {
        const text = message.content?.trim();
        if (text) {
            events.push(buildMessageEvent(message, events.length, text));
        }
        for (const toolCall of message.toolCalls) {
            events.push(buildToolCallEvent(message, toolCall, events.length, transcript.session.worktree));
            const output = buildToolOutputEvent(message, toolCall, events.length);
            if (output) {
                events.push(output);
            }
        }
    }
    return events;
};

export const getFxThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats =>
    getThreadTranscriptStats(events);
