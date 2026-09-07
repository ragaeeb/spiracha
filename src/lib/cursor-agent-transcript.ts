import type { CursorBubble, CursorToolCall } from './cursor-exporter-types';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const isRenderableCursorBubble = (bubble: CursorBubble): boolean => {
    return Boolean(bubble.text.trim() || bubble.thinking?.trim() || bubble.toolCall);
};

const getAgentTranscriptContentParts = (entry: UnknownRecord): UnknownRecord[] => {
    const message = isRecord(entry.message) ? entry.message : null;
    const content = message?.content ?? entry.content;
    if (Array.isArray(content)) {
        return content.filter(isRecord);
    }

    if (typeof content === 'string') {
        return [{ text: content, type: 'text' }];
    }

    return [];
};

const parseAgentTranscriptToolCall = (parts: UnknownRecord[]): CursorToolCall | null => {
    const toolUse = parts.find((part) => part.type === 'tool_use');
    if (!toolUse || typeof toolUse.name !== 'string' || !toolUse.name) {
        return null;
    }

    let argumentsText: string | null = null;
    if (toolUse.input !== undefined) {
        try {
            const serialized = JSON.stringify(toolUse.input);
            argumentsText = typeof serialized === 'string' ? serialized : null;
        } catch {
            argumentsText = null;
        }
    }

    return {
        argumentsText,
        callId: typeof toolUse.id === 'string' ? toolUse.id : null,
        name: toolUse.name,
        resultText: null,
        status: null,
    };
};

export const parseCursorAgentTranscriptRecord = (raw: unknown, bubbleId: string): CursorBubble | null => {
    if (!isRecord(raw)) {
        return null;
    }

    const message = isRecord(raw.message) ? raw.message : null;
    const roleValue = raw.role ?? message?.role;
    const kind = roleValue === 'user' || roleValue === 'assistant' ? roleValue : 'unknown';
    const parts = getAgentTranscriptContentParts(raw);
    const text = parts
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => (typeof part.text === 'string' ? part.text : null))
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n\n');
    const bubble: CursorBubble = {
        bubbleId,
        createdAtMs: null,
        kind,
        text,
        thinking: null,
        toolCall: parseAgentTranscriptToolCall(parts),
    };

    return isRenderableCursorBubble(bubble) ? bubble : null;
};
