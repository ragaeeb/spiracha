import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { KiroSessionTranscript, KiroTranscriptEntry, KiroTranscriptPart } from '@spiracha/lib/kiro-exporter-types';
import { getFinalKiroAssistantMessageEntryIds, getKiroMessagePhase } from '@spiracha/lib/kiro-transcript-phase';
import type { JsonValue } from '@spiracha/lib/shared';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const buildRaw = (
    entry: KiroTranscriptEntry,
    part: KiroTranscriptPart,
    eventType: string,
): Record<string, JsonValue> => ({
    entryId: entry.entryId,
    eventType,
    executionId: entry.executionId,
    role: entry.role,
    source: 'kiro_workspace_sessions',
    type: part.type,
    ...part.raw,
});

const buildMessageEvent = (
    transcript: KiroSessionTranscript,
    entry: KiroTranscriptEntry,
    part: KiroTranscriptPart,
    sequence: number,
    text: string,
    phase: Extract<ThreadEvent, { kind: 'message' }>['phase'],
): ThreadEvent => ({
    isHiddenByDefault: entry.role !== 'assistant' && entry.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: transcript.session.selectedModel ?? transcript.session.defaultModelTitle,
    phase,
    raw: buildRaw(entry, part, 'message'),
    role: entry.role,
    sequence,
    text,
    timestamp: entry.timestamp,
    variant: entry.role === 'user' ? 'user_message' : entry.role === 'assistant' ? 'agent_message' : 'message',
});

const getPartString = (part: KiroTranscriptPart, key: string): string | null => {
    const value = part.raw[key];
    return typeof value === 'string' && value.trim() ? value : null;
};

const buildToolCallEvent = (
    transcript: KiroSessionTranscript,
    entry: KiroTranscriptEntry,
    part: KiroTranscriptPart,
    sequence: number,
    command: string,
): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: command,
    callId: entry.entryId,
    command,
    kind: 'tool_call',
    name: getPartString(part, 'toolName') ?? 'kiro_action',
    raw: buildRaw(entry, part, 'tool_call'),
    sequence,
    timestamp: entry.timestamp,
    workdir: transcript.session.worktree,
});

const partToEvents = (
    transcript: KiroSessionTranscript,
    entry: KiroTranscriptEntry,
    part: KiroTranscriptPart,
    sequence: number,
    finalAssistantMessageEntryIds: Set<string>,
): ThreadEvent[] => {
    if (entry.entryType === 'tool_call' && part.type === 'text') {
        const command = part.text?.trim();
        return command ? [buildToolCallEvent(transcript, entry, part, sequence, command)] : [];
    }

    if (part.type === 'text' || part.type === 'image') {
        const text = part.text?.trim();
        return text
            ? [
                  buildMessageEvent(
                      transcript,
                      entry,
                      part,
                      sequence,
                      text,
                      getKiroMessagePhase(entry, finalAssistantMessageEntryIds),
                  ),
              ]
            : [];
    }

    return [];
};

export const kiroTranscriptToThreadEvents = (transcript: KiroSessionTranscript): ThreadEvent[] => {
    const events: ThreadEvent[] = [];
    const finalAssistantMessageEntryIds = getFinalKiroAssistantMessageEntryIds(transcript.entries);
    let sequence = 0;

    for (const entry of transcript.entries) {
        for (const part of entry.parts) {
            events.push(...partToEvents(transcript, entry, part, sequence, finalAssistantMessageEntryIds));
            sequence += 1;
        }
    }
    return events;
};

export const getKiroThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    return getThreadTranscriptStats(events);
};
