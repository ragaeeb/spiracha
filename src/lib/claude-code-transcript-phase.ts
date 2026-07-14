import type { JsonValue } from './shared';

export type ClaudeCodeAssistantMessagePhase = 'commentary' | 'final_answer';

type ClaudeCodeAssistantPhaseEntry = {
    assistantPhase?: ClaudeCodeAssistantMessagePhase | null;
    parts?: Array<{
        text?: string;
        type: string;
    }>;
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

export const isClaudeCodeRawFlagEnabled = (value: JsonValue | undefined): boolean => {
    return value === true || value === 'true';
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
    if (stopReason !== 'tool_use') {
        return 'final_answer';
    }

    const toolUseIndex = entry.parts?.findIndex((part) => part.type === 'tool_use') ?? -1;
    const hasTextAfterToolUse =
        toolUseIndex >= 0 &&
        entry.parts?.slice(toolUseIndex + 1).some((part) => part.type === 'text' && part.text?.trim()) === true;
    return hasTextAfterToolUse ? 'final_answer' : 'commentary';
};

export const isClaudeCodeSyntheticTranscriptEntry = (entry: ClaudeCodeFilterEntry): boolean => {
    if (
        isClaudeCodeRawFlagEnabled(entry.raw.isApiErrorMessage) ||
        isClaudeCodeRawFlagEnabled(entry.raw.isMeta) ||
        isClaudeCodeRawFlagEnabled(entry.raw.isCompactSummary)
    ) {
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
