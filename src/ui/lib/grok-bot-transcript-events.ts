import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { ConversationMessage } from '@spiracha/lib/conversation-data/types';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const toTimestamp = (createdAtMs: number | null) => (createdAtMs === null ? null : new Date(createdAtMs).toISOString());

const getAuthorName = (message: ConversationMessage) => {
    const authorName = message.metadata.authorName;
    return typeof authorName === 'string' && authorName.trim() ? authorName : null;
};

const getRawMessage = (message: ConversationMessage) => ({
    id: message.id,
    phase: message.phase,
    role: message.role,
    source: 'grok_bot',
    text: message.text,
});

type GrokBotRawMessage = ReturnType<typeof getRawMessage>;

const messageToReasoningEvent = (
    message: ConversationMessage,
    raw: GrokBotRawMessage,
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
    raw: GrokBotRawMessage,
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
    raw: GrokBotRawMessage,
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
    raw: GrokBotRawMessage,
    sequence: number,
    timestamp: string | null,
): ThreadEvent => {
    const authorName = getAuthorName(message);
    return {
        isHiddenByDefault: message.role !== 'assistant' && message.role !== 'user',
        kind: 'message',
        memoryCitation: null,
        model: authorName,
        phase: message.phase === 'unknown' ? null : message.phase,
        raw,
        role: message.role,
        sequence,
        text: message.text,
        timestamp,
        variant: message.role === 'user' ? 'user_message' : message.role === 'assistant' ? 'agent_message' : 'message',
    };
};

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

export const grokBotMessagesToThreadEvents = (messages: ConversationMessage[]): ThreadEvent[] =>
    messages.map((message, index) => messageToEvent(message, index));

export const getGrokBotThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats =>
    getThreadTranscriptStats(events);
