import type { KiroTranscriptEntry } from './kiro-exporter-types';

export type KiroMessagePhase = 'commentary' | 'final_answer' | null;

const KIRO_ASSISTANT_PLACEHOLDER_PATTERN = /^on it[.!]?$/iu;

export const isKiroAssistantPlaceholderEntry = (entry: KiroTranscriptEntry): boolean => {
    if (entry.role !== 'assistant') {
        return false;
    }

    const text = entry.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text?.trim())
        .filter(Boolean)
        .join('\n\n');
    return KIRO_ASSISTANT_PLACEHOLDER_PATTERN.test(text);
};

const belongsToAssistantExecution = (toolEntry: KiroTranscriptEntry, assistantEntry: KiroTranscriptEntry): boolean => {
    return (
        !assistantEntry.executionId || !toolEntry.executionId || assistantEntry.executionId === toolEntry.executionId
    );
};

export const getFinalKiroAssistantMessageEntryIds = (entries: KiroTranscriptEntry[]): Set<string> => {
    const finalEntryIds = new Set<string>();
    let latestAssistantMessageEntry: KiroTranscriptEntry | null = null;

    const flushAssistantRun = () => {
        if (latestAssistantMessageEntry) {
            finalEntryIds.add(latestAssistantMessageEntry.entryId);
            latestAssistantMessageEntry = null;
        }
    };

    for (const entry of entries) {
        if (entry.entryType === 'tool_call' || entry.entryType === 'tool_output') {
            if (latestAssistantMessageEntry && belongsToAssistantExecution(entry, latestAssistantMessageEntry)) {
                latestAssistantMessageEntry = null;
            }
            continue;
        }

        if (entry.role === 'user') {
            flushAssistantRun();
            continue;
        }

        if (entry.role === 'assistant') {
            if (isKiroAssistantPlaceholderEntry(entry)) {
                continue;
            }
            latestAssistantMessageEntry = entry;
        }
    }

    flushAssistantRun();
    return finalEntryIds;
};

export const getKiroMessagePhase = (entry: KiroTranscriptEntry, finalAssistantMessageEntryIds: Set<string>) => {
    if (entry.role !== 'assistant') {
        return null;
    }

    return finalAssistantMessageEntryIds.has(entry.entryId) ? 'final_answer' : 'commentary';
};
