import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { OpenCodeSessionTranscript, OpenCodeTranscriptPart } from '@spiracha/lib/opencode-exporter-types';
import { splitOpenCodeThinkTaggedText } from '@spiracha/lib/opencode-think-tags';
import {
    getFinalOpenCodeAssistantTextPartIds,
    getOpenCodeTextPartPhase,
} from '@spiracha/lib/opencode-transcript-phase';
import type { JsonValue } from '@spiracha/lib/shared';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const toTimestamp = (value: number | null | undefined): string | null => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return null;
    }

    return new Date(value).toISOString();
};

const buildRaw = (part: OpenCodeTranscriptPart, eventType: string): Record<string, JsonValue> => ({
    eventType,
    messageId: part.messageId,
    partId: part.partId,
    role: part.role,
    source: 'opencode_part',
    type: part.type,
    ...part.raw,
});

const buildMessageEvent = (
    part: OpenCodeTranscriptPart,
    sequence: number,
    text: string,
    phase: string | null,
): ThreadEvent => ({
    isHiddenByDefault: part.role !== 'assistant' && part.role !== 'user',
    kind: 'message',
    memoryCitation: null,
    model: null,
    phase,
    raw: buildRaw(part, 'message'),
    role: part.role,
    sequence,
    text,
    timestamp: toTimestamp(part.createdAtMs),
    variant: part.role === 'user' ? 'user_message' : part.role === 'assistant' ? 'agent_message' : 'message',
});

const buildReasoningEventFromText = (
    part: OpenCodeTranscriptPart,
    sequence: number,
    textValue: string | null | undefined,
): ThreadEvent | null => {
    const text = textValue?.trim();
    if (!text) {
        return null;
    }

    return {
        content: text,
        hasEncryptedContent: false,
        kind: 'reasoning',
        raw: buildRaw(part, 'reasoning'),
        sequence,
        summary: [text],
        timestamp: toTimestamp(part.createdAtMs),
    };
};

const buildReasoningEvent = (part: OpenCodeTranscriptPart, sequence: number): ThreadEvent | null => {
    const { reasoningBlocks, visibleText } = splitOpenCodeThinkTaggedText(part.text ?? '');
    return buildReasoningEventFromText(part, sequence, [...reasoningBlocks, visibleText].filter(Boolean).join('\n\n'));
};

const buildToolCallCommand = (part: OpenCodeTranscriptPart): string => {
    const toolName = part.toolName ?? 'unknown';
    if (!part.argumentsText?.trim()) {
        return toolName;
    }

    return `${toolName}\n${part.argumentsText}`;
};

const buildToolCallEvent = (part: OpenCodeTranscriptPart, sequence: number): ThreadEvent => ({
    argumentsParseFailed: false,
    argumentsText: part.argumentsText ?? null,
    callId: part.callId ?? null,
    command: buildToolCallCommand(part),
    kind: 'tool_call',
    name: part.toolName ?? 'unknown',
    raw: buildRaw(part, 'tool_call'),
    sequence,
    timestamp: toTimestamp(part.createdAtMs),
    workdir: null,
});

const buildToolOutputEvent = (part: OpenCodeTranscriptPart, sequence: number): ThreadEvent | null => {
    const outputText = part.outputText?.trim();
    if (!outputText) {
        return null;
    }

    return {
        callId: part.callId ?? null,
        exitCode: null,
        kind: 'tool_output',
        outputText,
        raw: buildRaw(part, 'tool_output'),
        sequence,
        summary: outputText,
        timestamp: toTimestamp(part.createdAtMs),
        wallTime: null,
    };
};

const buildStepStartedEvent = (part: OpenCodeTranscriptPart, sequence: number): ThreadEvent => ({
    collaborationModeKind: null,
    kind: 'task_started',
    modelContextWindow: null,
    raw: buildRaw(part, 'step_start'),
    sequence,
    startedAt: part.startTimeMs ?? part.createdAtMs,
    timestamp: toTimestamp(part.createdAtMs),
    turnId: part.messageId,
});

const buildStepCompleteEvent = (part: OpenCodeTranscriptPart, sequence: number): ThreadEvent => ({
    completedAt: part.endTimeMs ?? part.updatedAtMs,
    durationMs: part.startTimeMs && part.endTimeMs ? part.endTimeMs - part.startTimeMs : null,
    kind: 'task_complete',
    lastAgentMessage: part.reason ?? null,
    raw: buildRaw(part, 'step_finish'),
    sequence,
    timestamp: toTimestamp(part.updatedAtMs),
    timeToFirstTokenMs: null,
    turnId: part.messageId,
});

const flattenParts = (transcript: OpenCodeSessionTranscript): OpenCodeTranscriptPart[] => {
    return transcript.messages.flatMap((message) => message.parts);
};

const textPartToEvents = (
    part: OpenCodeTranscriptPart,
    sequence: number,
    finalAssistantTextPartIds: Set<string>,
): ThreadEvent[] => {
    const { reasoningBlocks, visibleText } =
        part.role === 'assistant'
            ? splitOpenCodeThinkTaggedText(part.text ?? '')
            : { reasoningBlocks: [], visibleText: part.text ?? '' };
    const events: ThreadEvent[] = [];

    if (part.role === 'assistant') {
        events.push(
            ...reasoningBlocks
                .map((block, index) => buildReasoningEventFromText(part, sequence + index, block))
                .filter((event): event is ThreadEvent => event !== null),
        );
    }

    const text = visibleText.trim();
    if (!text) {
        return events;
    }

    const messageSequence = sequence + events.length;
    const phase = getOpenCodeTextPartPhase(part, finalAssistantTextPartIds);
    events.push(buildMessageEvent(part, messageSequence, text, phase));
    return events;
};

const toolPartToEvents = (part: OpenCodeTranscriptPart, sequence: number): ThreadEvent[] => {
    const output = buildToolOutputEvent(part, sequence + 1);
    return [buildToolCallEvent(part, sequence), output].filter((event): event is ThreadEvent => event !== null);
};

const partToEvents = (
    part: OpenCodeTranscriptPart,
    sequence: number,
    finalAssistantTextPartIds: Set<string>,
): ThreadEvent[] => {
    if (part.type === 'text') {
        return textPartToEvents(part, sequence, finalAssistantTextPartIds);
    }

    if (part.type === 'reasoning') {
        const event = buildReasoningEvent(part, sequence);
        return event ? [event] : [];
    }

    if (part.type === 'tool') {
        return toolPartToEvents(part, sequence);
    }

    if (part.type === 'step-start') {
        return [buildStepStartedEvent(part, sequence)];
    }

    if (part.type === 'step-finish') {
        return [buildStepCompleteEvent(part, sequence)];
    }

    return [];
};

export const openCodeTranscriptToThreadEvents = (transcript: OpenCodeSessionTranscript): ThreadEvent[] => {
    const parts = flattenParts(transcript);
    const finalAssistantTextPartIds = getFinalOpenCodeAssistantTextPartIds(parts);
    const events: ThreadEvent[] = [];
    let sequence = 0;
    for (const part of parts) {
        const partEvents = partToEvents(part, sequence, finalAssistantTextPartIds);
        events.push(...partEvents);
        sequence += Math.max(partEvents.length, 1);
    }
    return events;
};

export const getOpenCodeThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    return getThreadTranscriptStats(events);
};
