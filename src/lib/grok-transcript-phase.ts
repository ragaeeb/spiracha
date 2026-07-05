import type { GrokTranscriptEntry, GrokTranscriptPart } from './grok-exporter-types';

export type GrokAssistantMessagePhase = 'commentary' | 'final_answer' | 'unknown';

export const getFinalGrokAssistantTextPartIds = (entries: GrokTranscriptEntry[]): Set<string> => {
    const finalPart = [...entries]
        .reverse()
        .flatMap((entry) =>
            [...entry.parts]
                .reverse()
                .map((part) => ({ entry, part }))
                .filter(({ part }) => part.type === 'text' && Boolean(part.text?.trim())),
        )
        .find(({ entry }) => entry.role === 'assistant');

    return finalPart ? new Set([finalPart.part.partId]) : new Set();
};

export const getGrokTextPartPhase = (
    entry: GrokTranscriptEntry,
    part: GrokTranscriptPart,
    finalTextPartIds: Set<string>,
): GrokAssistantMessagePhase => {
    if (entry.role !== 'assistant') {
        return 'unknown';
    }

    return finalTextPartIds.has(part.partId) ? 'final_answer' : 'commentary';
};
