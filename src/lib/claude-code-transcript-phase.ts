import type { JsonValue } from './shared';

export type ClaudeCodeAssistantMessagePhase = 'commentary' | 'final_answer';

type ClaudeCodeAssistantPhaseEntry = {
    assistantPhase?: ClaudeCodeAssistantMessagePhase | null;
    raw: Record<string, JsonValue>;
    role: string;
};

type ClaudeCodeFilterEntry = ClaudeCodeAssistantPhaseEntry & {
    parts: Array<{
        text?: string;
        type: string;
    }>;
};

const SYNTHETIC_USER_TEXT_PREFIXES = [
    '<local-command-caveat>',
    '<local-command-stdout>',
    '<task-notification>',
    '[Request interrupted by user]',
] as const;

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

    if (entry.assistantPhase) {
        return entry.assistantPhase;
    }

    const stopReason = asMessageObject(entry.raw.message)?.stop_reason;
    return stopReason === 'tool_use' ? 'commentary' : 'final_answer';
};

export const isClaudeCodeSyntheticTranscriptEntry = (entry: ClaudeCodeFilterEntry): boolean => {
    if (entry.raw.isApiErrorMessage === true || entry.raw.isMeta === true || entry.raw.isCompactSummary === true) {
        return true;
    }

    if (asMessageObject(entry.raw.message)?.model === '<synthetic>') {
        return true;
    }

    if (entry.role !== 'user') {
        return false;
    }

    const text = entry.parts.find((part) => part.type === 'text')?.text?.trim() ?? '';
    return (
        text.startsWith('<command-name>/compact</command-name>') ||
        SYNTHETIC_USER_TEXT_PREFIXES.some((prefix) => text.startsWith(prefix))
    );
};
