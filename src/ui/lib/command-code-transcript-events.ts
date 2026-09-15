import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/conversation-data/conversation-events';
import type { ConversationMessage } from '@spiracha/lib/conversation-data/types';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const toTimestamp = (createdAtMs: number | null) => (createdAtMs === null ? null : new Date(createdAtMs).toISOString());

const getRawMessage = (message: ConversationMessage) => ({
    id: message.id,
    phase: message.phase,
    role: message.role,
    source: 'command_code',
    text: message.text,
});

type CommandCodeRawMessage = ReturnType<typeof getRawMessage>;

const messageToReasoningEvent = (
    message: ConversationMessage,
    raw: CommandCodeRawMessage,
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

const messageToToolCallEvent = (
    message: ConversationMessage,
    raw: CommandCodeRawMessage,
    sequence: number,
    timestamp: string | null,
): ThreadEvent => {
    const toolEvidence = message.toolEvidence;
    const name = toolEvidence?.name ?? 'unknown';
    return {
        argumentsParseFailed: false,
        argumentsText: toolEvidence?.inputText ?? null,
        callId: toolEvidence?.callId ?? null,
        command: toolEvidence?.command ?? name,
        kind: 'tool_call',
        name,
        raw,
        sequence,
        timestamp,
        workdir: toolEvidence?.workdir ?? null,
    };
};

const messageToToolOutputEvent = (
    message: ConversationMessage,
    raw: CommandCodeRawMessage,
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

const messageToMessageEvent = (
    message: ConversationMessage,
    raw: CommandCodeRawMessage,
    sequence: number,
    timestamp: string | null,
): ThreadEvent => ({
    isHiddenByDefault: message.role !== 'assistant' && message.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: message.model ?? null,
    phase: message.phase === 'unknown' ? null : message.phase,
    raw,
    role: message.role,
    sequence,
    text: message.text,
    timestamp,
    variant: message.role === 'user' ? 'user_message' : message.role === 'assistant' ? 'agent_message' : 'message',
});

const messageToEvent = (message: ConversationMessage, sequence: number): ThreadEvent => {
    const timestamp = toTimestamp(message.createdAtMs);
    const raw = getRawMessage(message);

    if (message.phase === 'reasoning') {
        return messageToReasoningEvent(message, raw, sequence, timestamp);
    }
    if (message.phase === 'tool_call') {
        return messageToToolCallEvent(message, raw, sequence, timestamp);
    }
    if (message.phase === 'tool_output') {
        return messageToToolOutputEvent(message, raw, sequence, timestamp);
    }
    return messageToMessageEvent(message, raw, sequence, timestamp);
};

export const commandCodeMessagesToThreadEvents = (messages: ConversationMessage[]): ThreadEvent[] =>
    messages.map((message, index) => messageToEvent(message, index));

export const getCommandCodeThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats =>
    getThreadTranscriptStats(events);
