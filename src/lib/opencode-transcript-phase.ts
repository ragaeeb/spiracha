import type { OpenCodeTranscriptPart } from './opencode-exporter-types';
import { splitOpenCodeThinkTaggedText } from './opencode-think-tags';

export type OpenCodeMessagePhase = 'commentary' | 'final_answer' | null;

export const getFinalOpenCodeAssistantTextPartIds = (parts: OpenCodeTranscriptPart[]): Set<string> => {
    const finalPartIds = new Set<string>();
    let latestAssistantTextPartId: string | null = null;

    const flushAssistantRun = () => {
        if (latestAssistantTextPartId) {
            finalPartIds.add(latestAssistantTextPartId);
            latestAssistantTextPartId = null;
        }
    };

    for (const part of parts) {
        if (part.role === 'user') {
            flushAssistantRun();
            continue;
        }

        if (part.role !== 'assistant') {
            continue;
        }

        if (part.type === 'tool') {
            latestAssistantTextPartId = null;
            continue;
        }

        if (part.type === 'text' && splitOpenCodeThinkTaggedText(part.text ?? '').visibleText.trim()) {
            latestAssistantTextPartId = part.partId;
        }
    }

    flushAssistantRun();
    return finalPartIds;
};

export const getOpenCodeTextPartPhase = (
    part: OpenCodeTranscriptPart,
    finalAssistantTextPartIds: Set<string>,
): OpenCodeMessagePhase => {
    if (part.role !== 'assistant') {
        return null;
    }

    return finalAssistantTextPartIds.has(part.partId) ? 'final_answer' : 'commentary';
};
