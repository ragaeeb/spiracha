import type { CursorBubble } from './cursor-exporter-types';

export type CursorMessagePhase = 'commentary' | 'final_answer' | null;

export const getFinalCursorAssistantTextBubbleIds = (bubbles: CursorBubble[]): Set<string> => {
    const finalBubbleIds = new Set<string>();
    let latestAssistantTextBubbleId: string | null = null;

    const flushAssistantRun = () => {
        if (latestAssistantTextBubbleId) {
            finalBubbleIds.add(latestAssistantTextBubbleId);
            latestAssistantTextBubbleId = null;
        }
    };

    for (const bubble of bubbles) {
        if (bubble.kind !== 'assistant') {
            flushAssistantRun();
            continue;
        }

        if (bubble.text.trim()) {
            latestAssistantTextBubbleId = bubble.bubbleId;
        }
    }

    flushAssistantRun();
    return finalBubbleIds;
};

export const getCursorTextBubblePhase = (
    bubble: CursorBubble,
    finalAssistantTextBubbleIds: Set<string>,
): CursorMessagePhase => {
    if (bubble.kind !== 'assistant') {
        return null;
    }

    return finalAssistantTextBubbleIds.has(bubble.bubbleId) ? 'final_answer' : 'commentary';
};
