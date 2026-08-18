import type { ClineTaskTranscript, ClineTranscriptMessage } from '@spiracha/lib/cline-exporter-types';
import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { JsonValue } from '@spiracha/lib/shared';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const timestamp = (value: number | null) => (value === null ? null : new Date(value).toISOString());
const raw = (message: ClineTranscriptMessage): Record<string, JsonValue> => ({
    messageId: message.messageId,
    phase: message.phase,
    role: message.role,
    source: 'cline_session_messages',
    ...message.raw,
});

const toToolCallEvent = (message: ClineTranscriptMessage, sequence: number, worktree: string): ThreadEvent | null => {
    if (message.phase !== 'tool_call' || !message.tool) {
        return null;
    }
    return {
        argumentsParseFailed: false,
        argumentsText: message.tool.inputText,
        callId: message.tool.callId,
        command: message.tool.command ?? message.text,
        kind: 'tool_call',
        name: message.tool.name,
        raw: raw(message),
        sequence,
        timestamp: timestamp(message.createdAtMs),
        workdir: message.tool.workdir ?? worktree,
    };
};

const toToolOutputEvent = (message: ClineTranscriptMessage, sequence: number): ThreadEvent | null => {
    if (message.phase !== 'tool_output' || !message.tool) {
        return null;
    }
    return {
        callId: message.tool.callId,
        exitCode: message.tool.status === 'failed' ? 1 : message.tool.status === 'succeeded' ? 0 : null,
        kind: 'tool_output',
        outputText: message.text,
        raw: raw(message),
        sequence,
        summary: message.text,
        timestamp: timestamp(message.createdAtMs),
        wallTime: null,
    };
};

const toEvent = (message: ClineTranscriptMessage, sequence: number, worktree: string): ThreadEvent => {
    if (message.phase === 'reasoning') {
        return {
            content: message.text,
            hasEncryptedContent: false,
            kind: 'reasoning',
            raw: raw(message),
            sequence,
            summary: [message.text],
            timestamp: timestamp(message.createdAtMs),
        };
    }
    const toolEvent = toToolCallEvent(message, sequence, worktree) ?? toToolOutputEvent(message, sequence);
    if (toolEvent) {
        return toolEvent;
    }
    return {
        isHiddenByDefault: message.role !== 'assistant' && message.role !== 'user',
        kind: 'message',
        memoryCitation: null,
        model: null,
        phase: message.phase === 'unknown' ? null : message.phase,
        raw: raw(message),
        role: message.role,
        sequence,
        text: message.text,
        timestamp: timestamp(message.createdAtMs),
        variant: message.role === 'user' ? 'user_message' : message.role === 'assistant' ? 'agent_message' : 'message',
    };
};

export const clineTranscriptToThreadEvents = (transcript: ClineTaskTranscript): ThreadEvent[] =>
    transcript.messages.map((message, sequence) => toEvent(message, sequence, transcript.task.worktree));

export const getClineThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats =>
    getThreadTranscriptStats(events);
