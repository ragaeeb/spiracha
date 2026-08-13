import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type {
    QoderSessionTranscript,
    QoderTranscriptEntry,
    QoderTranscriptPart,
} from '@spiracha/lib/qoder-exporter-types';
import { getFinalQoderAssistantMessageEntryIds, getQoderMessagePhase } from '@spiracha/lib/qoder-transcript-phase';
import type { JsonValue } from '@spiracha/lib/shared';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const buildRaw = (
    entry: QoderTranscriptEntry,
    part: QoderTranscriptPart,
    eventType: string,
): Record<string, JsonValue> => ({
    entryId: entry.entryId,
    eventType,
    requestId: entry.requestId,
    role: entry.role,
    source: 'qoder_local_history',
    type: part.type,
    ...part.raw,
});

const buildMessageEvent = (
    transcript: QoderSessionTranscript,
    entry: QoderTranscriptEntry,
    part: QoderTranscriptPart,
    sequence: number,
    text: string,
    phase: Extract<ThreadEvent, { kind: 'message' }>['phase'],
): ThreadEvent => ({
    isHiddenByDefault: entry.role !== 'assistant' && entry.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: transcript.session.model ?? 'Qoder',
    phase,
    raw: buildRaw(entry, part, 'message'),
    role: entry.role,
    sequence,
    text,
    timestamp: entry.timestamp,
    variant: entry.role === 'user' ? 'user_message' : entry.role === 'assistant' ? 'agent_message' : 'message',
});

const getPartString = (part: QoderTranscriptPart, key: string): string | null => {
    const value = part.raw[key];
    return typeof value === 'string' && value.trim() ? value : null;
};

const buildToolCallEvent = (
    transcript: QoderSessionTranscript,
    entry: QoderTranscriptEntry,
    part: QoderTranscriptPart,
    sequence: number,
    command: string,
): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: command,
    callId: getPartString(part, 'toolCallId') ?? entry.entryId,
    command,
    kind: 'tool_call',
    name: getPartString(part, 'toolName') ?? 'qoder_file_operation',
    raw: buildRaw(entry, part, 'tool_call'),
    sequence,
    timestamp: entry.timestamp,
    workdir: transcript.session.worktree,
});

const buildToolOutputEvent = (
    entry: QoderTranscriptEntry,
    part: QoderTranscriptPart,
    sequence: number,
    outputText: string,
): ThreadEvent => ({
    callId: getPartString(part, 'toolCallId'),
    exitCode: null,
    kind: 'tool_output',
    outputText,
    raw: buildRaw(entry, part, 'tool_output'),
    sequence,
    summary: outputText,
    timestamp: entry.timestamp,
    wallTime: null,
});

const partToEvents = (
    transcript: QoderSessionTranscript,
    entry: QoderTranscriptEntry,
    part: QoderTranscriptPart,
    sequence: number,
    finalAssistantMessageEntryIds: Set<string>,
): ThreadEvent[] => {
    if (entry.entryType === 'tool_call' && part.type === 'text') {
        const command = part.text?.trim();
        return command ? [buildToolCallEvent(transcript, entry, part, sequence, command)] : [];
    }

    if (entry.entryType === 'tool_output' && part.type === 'text') {
        const outputText = part.text?.trim();
        return outputText ? [buildToolOutputEvent(entry, part, sequence, outputText)] : [];
    }

    if (part.type === 'text') {
        const text = part.text?.trim();
        return text
            ? [
                  buildMessageEvent(
                      transcript,
                      entry,
                      part,
                      sequence,
                      text,
                      getQoderMessagePhase(entry, finalAssistantMessageEntryIds),
                  ),
              ]
            : [];
    }

    return [];
};

export const qoderTranscriptToThreadEvents = (transcript: QoderSessionTranscript): ThreadEvent[] => {
    const events: ThreadEvent[] = [];
    const finalAssistantMessageEntryIds = getFinalQoderAssistantMessageEntryIds(transcript.entries);
    let sequence = 0;

    for (const entry of transcript.entries) {
        for (const part of entry.parts) {
            events.push(...partToEvents(transcript, entry, part, sequence, finalAssistantMessageEntryIds));
            sequence += 1;
        }
    }
    return events;
};

export const getQoderThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    return getThreadTranscriptStats(events);
};
