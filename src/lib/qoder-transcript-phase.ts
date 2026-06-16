import type { QoderTranscriptEntry } from './qoder-exporter-types';

export type QoderMessagePhase = 'commentary' | 'final_answer' | null;

export const getFinalQoderAssistantMessageEntryIds = (entries: QoderTranscriptEntry[]): Set<string> => {
    const finalEntryIds = new Set<string>();
    let latestAssistantMessageEntryId: string | null = null;

    const flushAssistantRun = () => {
        if (latestAssistantMessageEntryId) {
            finalEntryIds.add(latestAssistantMessageEntryId);
            latestAssistantMessageEntryId = null;
        }
    };

    for (const entry of entries) {
        if (entry.entryType === 'tool_call') {
            continue;
        }

        if (entry.role === 'user') {
            flushAssistantRun();
            continue;
        }

        if (entry.role === 'assistant') {
            latestAssistantMessageEntryId = entry.entryId;
        }
    }

    flushAssistantRun();
    return finalEntryIds;
};

export const getQoderMessagePhase = (entry: QoderTranscriptEntry, finalAssistantMessageEntryIds: Set<string>) => {
    if (entry.role !== 'assistant') {
        return null;
    }

    return finalAssistantMessageEntryIds.has(entry.entryId) ? 'final_answer' : 'commentary';
};
