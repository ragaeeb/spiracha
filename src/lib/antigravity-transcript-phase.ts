export type AntigravityTranscriptPhaseItem = {
    hasContent: boolean;
    hasToolCalls: boolean;
    role: 'assistant' | 'other' | 'user';
    sequence: number;
};

export type AntigravityAssistantMessagePhase = 'commentary' | 'final_answer';

export const getFinalAntigravityAssistantSequences = (items: AntigravityTranscriptPhaseItem[]): Set<number> => {
    const finalSequences = new Set<number>();
    let latestAssistantContentSequence: number | null = null;

    const flushAssistantRun = () => {
        if (latestAssistantContentSequence !== null) {
            finalSequences.add(latestAssistantContentSequence);
        }
        latestAssistantContentSequence = null;
    };

    for (const item of items) {
        if (item.role === 'user') {
            flushAssistantRun();
            continue;
        }

        if (item.role !== 'assistant') {
            continue;
        }

        if (item.hasToolCalls) {
            latestAssistantContentSequence = null;
        } else if (item.hasContent) {
            latestAssistantContentSequence = item.sequence;
        }
    }

    flushAssistantRun();
    return finalSequences;
};

export const getAntigravityAssistantPhase = (
    sequence: number,
    finalAssistantSequences: Set<number>,
): AntigravityAssistantMessagePhase => {
    return finalAssistantSequences.has(sequence) ? 'final_answer' : 'commentary';
};
