import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { GrokSessionTranscript, GrokTranscriptEntry, GrokTranscriptPart } from '@spiracha/lib/grok-exporter-types';
import { getFinalGrokAssistantTextPartIds, getGrokTextPartPhase } from '@spiracha/lib/grok-transcript-phase';
import type { JsonValue } from '@spiracha/lib/shared';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const buildRaw = (
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
    eventType: string,
): Record<string, JsonValue> => ({
    entryId: entry.entryId,
    eventType,
    role: entry.role,
    source: 'grok_local_session',
    type: part.type,
    ...part.raw,
});

const buildMessageEvent = (
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
    sequence: number,
    text: string,
    finalTextPartIds: Set<string>,
): ThreadEvent => ({
    isHiddenByDefault: entry.role !== 'assistant' && entry.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: entry.modelId ?? null,
    phase: getGrokTextPartPhase(entry, part, finalTextPartIds),
    raw: buildRaw(entry, part, 'message'),
    role: entry.role,
    sequence,
    text,
    timestamp: entry.timestamp,
    variant: entry.role === 'user' ? 'user_message' : entry.role === 'assistant' ? 'agent_message' : 'message',
});

const buildReasoningEvent = (
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
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

const buildToolCallCommand = (part: GrokTranscriptPart): string => {
    const toolName = part.toolName ?? 'unknown';
    if (!part.argumentsText?.trim()) {
        return toolName;
    }

    return `${toolName}\n${part.argumentsText}`;
};

const buildToolCallEvent = (entry: GrokTranscriptEntry, part: GrokTranscriptPart, sequence: number): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: part.argumentsText ?? null,
    callId: part.toolCallId ?? null,
    command: buildToolCallCommand(part),
    kind: 'tool_call',
    name: part.toolName ?? 'unknown',
    raw: buildRaw(entry, part, 'tool_call'),
    sequence,
    timestamp: entry.timestamp,
    workdir: null,
});

const buildToolOutputEvent = (
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
    sequence: number,
): ThreadEvent | null => {
    const outputText = part.outputText?.trim();
    if (!outputText) {
        return null;
    }

    return {
        callId: part.toolCallId ?? null,
        exitCode: null,
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
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
    sequence: number,
    finalTextPartIds: Set<string>,
): ThreadEvent[] => {
    if (part.type === 'text') {
        const text = part.text?.trim();
        return text ? [buildMessageEvent(entry, part, sequence, text, finalTextPartIds)] : [];
    }

    if (part.type === 'reasoning') {
        const event = buildReasoningEvent(entry, part, sequence);
        return event ? [event] : [];
    }

    if (part.type === 'tool_call') {
        return [buildToolCallEvent(entry, part, sequence)];
    }

    if (part.type === 'tool_result') {
        const event = buildToolOutputEvent(entry, part, sequence);
        return event ? [event] : [];
    }

    return [];
};

export const grokTranscriptToThreadEvents = (transcript: GrokSessionTranscript): ThreadEvent[] => {
    const finalTextPartIds = getFinalGrokAssistantTextPartIds(transcript.entries);
    const events: ThreadEvent[] = [];
    let sequence = 0;
    for (const entry of transcript.entries) {
        for (const part of entry.parts) {
            events.push(...partToEvents(entry, part, sequence, finalTextPartIds));
            sequence += 1;
        }
    }
    return events;
};

export const getGrokThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    return getThreadTranscriptStats(events);
};
