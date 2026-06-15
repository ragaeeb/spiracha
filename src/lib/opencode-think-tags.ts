export type OpenCodeThinkTagText = {
    reasoningBlocks: string[];
    visibleText: string;
};

const THINK_TAG_PATTERN = /<think\b[^>]*>([\s\S]*?)(?:<\/think>|$)/gi;

const normalizeExtractedText = (text: string): string => {
    return text.replace(/\n{3,}/g, '\n\n').trim();
};

export const splitOpenCodeThinkTaggedText = (text: string): OpenCodeThinkTagText => {
    const reasoningBlocks: string[] = [];
    const visibleText = text.replace(THINK_TAG_PATTERN, (_match, reasoning: string) => {
        const normalizedReasoning = normalizeExtractedText(reasoning);
        if (normalizedReasoning) {
            reasoningBlocks.push(normalizedReasoning);
        }

        return '\n';
    });

    return {
        reasoningBlocks,
        visibleText: normalizeExtractedText(visibleText),
    };
};
