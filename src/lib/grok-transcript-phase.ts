import type { GrokTranscriptEntry, GrokTranscriptPart } from './grok-exporter-types';

export type GrokAssistantMessagePhase = 'commentary' | 'final_answer' | null;

export const getFinalGrokAssistantTextPartIds = (entries: GrokTranscriptEntry[]): Set<string> => {
    const finalPartIds = new Set<string>();
    let latestAssistantTextPartId: string | null = null;

    const flushAssistantRun = () => {
        if (latestAssistantTextPartId) {
            finalPartIds.add(latestAssistantTextPartId);
            latestAssistantTextPartId = null;
        }
    };

    for (const entry of entries) {
        if (entry.role === 'user') {
            flushAssistantRun();
            continue;
        }

        if (entry.role !== 'assistant') {
            continue;
        }

        for (const part of entry.parts) {
            if (part.type === 'tool_call') {
                latestAssistantTextPartId = null;
                continue;
            }

            if (part.type === 'text' && part.text?.trim()) {
                latestAssistantTextPartId = part.partId;
            }
        }
    }

    flushAssistantRun();
    return finalPartIds;
};

export const getGrokTextPartPhase = (
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
    finalTextPartIds: Set<string>,
): GrokAssistantMessagePhase => {
    if (entry.role !== 'assistant') {
        return null;
    }

    return finalTextPartIds.has(part.partId) ? 'final_answer' : 'commentary';
};
