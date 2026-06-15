import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { KiroSessionTranscript, KiroTranscriptEntry, KiroTranscriptPart } from '@spiracha/lib/kiro-exporter-types';
import { getFinalKiroAssistantMessageEntryIds, getKiroMessagePhase } from '@spiracha/lib/kiro-transcript-phase';
import type { JsonValue } from '@spiracha/lib/shared';

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

const getTextJoiner = (left: string, right: string): string => {
    const leftTrimmed = left.trim();
    const rightTrimmed = right.trim();
    return leftTrimmed.startsWith('|') && rightTrimmed.startsWith('|') ? '\n' : '\n\n';
};

const mergeTextParts = (left: KiroTranscriptPart, right: KiroTranscriptPart): KiroTranscriptPart => {
    const text = `${left.text ?? ''}${getTextJoiner(left.text ?? '', right.text ?? '')}${right.text ?? ''}`;
    return {
        raw: {
            sourceParts: [left.raw, right.raw],
            text,
            type: 'text',
        },
        text,
        type: 'text',
    };
};

const mergeAdjacentTextParts = (parts: KiroTranscriptPart[]): KiroTranscriptPart[] => {
    const merged: KiroTranscriptPart[] = [];

    for (const part of parts) {
        const previous = merged.at(-1);
        if (previous?.type === 'text' && part.type === 'text') {
            merged[merged.length - 1] = mergeTextParts(previous, part);
            continue;
        }

        merged.push(part);
    }

    return merged;
};

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

    transcript.entries.forEach((entry, entryIndex) => {
        mergeAdjacentTextParts(entry.parts).forEach((part, partIndex) => {
            events.push(
                ...partToEvents(
                    transcript,
                    entry,
                    part,
                    entryIndex * 100 + partIndex * 10,
                    finalAssistantMessageEntryIds,
                ),
            );
        });
    });
    return events;
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

export const getKiroThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
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
        if (event.kind === 'message') {
            updateMessageStats(stats, event);
        }
        if (event.kind === 'tool_call') {
            stats.toolCallCount += 1;
            if (event.name === 'Bash') {
                stats.execCommandCount += 1;
            }
        }
        if (event.kind === 'tool_output') {
            stats.toolOutputCount += 1;
        }
        if (event.kind === 'web_search') {
            stats.webSearchEventCount += 1;
        }
    }

    return stats;
};
