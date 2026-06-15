import type {
    ClaudeCodeSessionTranscript,
    ClaudeCodeTranscriptEntry,
    ClaudeCodeTranscriptPart,
} from '@spiracha/lib/claude-code-exporter-types';
import { getClaudeCodeAssistantMessagePhase } from '@spiracha/lib/claude-code-transcript-phase';
import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { JsonValue } from '@spiracha/lib/shared';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const buildRaw = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    eventType: string,
): Record<string, JsonValue> => ({
    entryId: entry.entryId,
    eventType,
    role: entry.role,
    source: 'claude_code_local_jsonl',
    type: part.type,
    ...part.raw,
});

const buildMessageEvent = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    sequence: number,
    text: string,
): ThreadEvent => ({
    isHiddenByDefault: entry.role !== 'assistant' && entry.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: entry.model ?? null,
    phase: getClaudeCodeAssistantMessagePhase(entry),
    raw: buildRaw(entry, part, 'message'),
    role: entry.role,
    sequence,
    text,
    timestamp: entry.timestamp,
    variant: entry.role === 'user' ? 'user_message' : entry.role === 'assistant' ? 'agent_message' : 'message',
});

const buildReasoningEvent = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    sequence: number,
): ThreadEvent | null => {
    const text = part.text?.trim();
    if (!text) {
        return null;
    }

    return {
        content: text,
        hasEncryptedContent: false,
        kind: 'reasoning',
        raw: buildRaw(entry, part, 'reasoning'),
        sequence,
        summary: [text],
        timestamp: entry.timestamp,
    };
};

const buildToolCallCommand = (part: ClaudeCodeTranscriptPart): string => {
    const toolName = part.toolName ?? 'unknown';
    if (!part.argumentsText?.trim()) {
        return toolName;
    }

    return `${toolName}\n${part.argumentsText}`;
};

const buildToolCallEvent = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    sequence: number,
): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: part.argumentsText ?? null,
    callId: part.toolUseId ?? null,
    command: buildToolCallCommand(part),
    kind: 'tool_call',
    name: part.toolName ?? 'unknown',
    raw: buildRaw(entry, part, 'tool_call'),
    sequence,
    timestamp: entry.timestamp,
    workdir: entry.cwd,
});

const buildToolOutputEvent = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    sequence: number,
): ThreadEvent | null => {
    const outputText = part.outputText?.trim();
    if (!outputText) {
        return null;
    }

    return {
        callId: part.toolUseId ?? null,
        exitCode: part.isError ? 1 : null,
        kind: 'tool_output',
        outputText,
        raw: buildRaw(entry, part, 'tool_output'),
        sequence,
        summary: outputText,
        timestamp: entry.timestamp,
        wallTime: null,
    };
};

const partToEvents = (
    entry: ClaudeCodeTranscriptEntry,
    part: ClaudeCodeTranscriptPart,
    sequence: number,
): ThreadEvent[] => {
    if (part.type === 'text' || part.type === 'attachment') {
        const text = part.text?.trim();
        return text ? [buildMessageEvent(entry, part, sequence, text)] : [];
    }

    if (part.type === 'thinking') {
        const event = buildReasoningEvent(entry, part, sequence);
        return event ? [event] : [];
    }

    if (part.type === 'tool_use') {
        return [buildToolCallEvent(entry, part, sequence)];
    }

    if (part.type === 'tool_result') {
        const event = buildToolOutputEvent(entry, part, sequence);
        return event ? [event] : [];
    }

    return [];
};

export const claudeCodeTranscriptToThreadEvents = (transcript: ClaudeCodeSessionTranscript): ThreadEvent[] => {
    const events: ThreadEvent[] = [];
    let sequence = 0;
    for (const entry of transcript.entries) {
        for (const part of entry.parts) {
            events.push(...partToEvents(entry, part, sequence));
            sequence += 1;
        }
    }
    return events;
};

export const getClaudeCodeThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    return getThreadTranscriptStats(events);
};
