import type { JsonValue } from './shared';

export type ClaudeCodeAssistantMessagePhase = 'commentary' | 'final_answer';

type ClaudeCodeAssistantPhaseEntry = {
    raw: Record<string, JsonValue>;
    role: string;
};

const asMessageObject = (value: JsonValue | undefined): Record<string, JsonValue> | null => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, JsonValue>)
        : null;
};

export const getClaudeCodeAssistantMessagePhase = (
    entry: ClaudeCodeAssistantPhaseEntry,
): ClaudeCodeAssistantMessagePhase | null => {
    if (entry.role !== 'assistant') {
        return null;
    }

    const stopReason = asMessageObject(entry.raw.message)?.stop_reason;
    return stopReason === 'tool_use' ? 'commentary' : 'final_answer';
};
