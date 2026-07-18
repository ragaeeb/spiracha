export type OpenCodeThinkTagText = {
    reasoningBlocks: string[];
    visibleText: string;
};

const THINK_OPEN_PATTERN = /<think\b[^>]*>/iy;
const THINK_CLOSE_PATTERN = /<\/think>/gi;
const THINK_CLOSE_TAG_LENGTH = '</think>'.length;

const normalizeExtractedText = (text: string): string => {
    return text.replace(/\n{3,}/g, '\n\n').trim();
};

const getBacktickRunLength = (text: string, start: number): number => {
    let end = start;
    while (text[end] === '`') {
        end += 1;
    }

    return end - start;
};

const findClosingBackticks = (text: string, start: number, runLength: number): number => {
    const marker = '`'.repeat(runLength);
    const index = text.indexOf(marker, start + runLength);
    return index === -1 ? text.length : index + runLength;
};

const findThinkCloseIndex = (text: string, start: number): number => {
    let cursor = start;
    while (cursor < text.length) {
        THINK_CLOSE_PATTERN.lastIndex = cursor;
        const match = THINK_CLOSE_PATTERN.exec(text);
        if (!match) {
            return -1;
        }

        const backtickIndex = text.indexOf('`', cursor);
        if (backtickIndex === -1 || backtickIndex >= match.index) {
            return match.index;
        }

        cursor = findClosingBackticks(text, backtickIndex, getBacktickRunLength(text, backtickIndex));
    }

    return -1;
};

const getLastVisibleChar = (parts: string[]): string => {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part) {
            return part.at(-1) ?? '';
        }
    }

    return '';
};

const getThinkReplacement = (previous: string, next: string): string => {
    if (previous === '\n' || next === '\n') {
        return '\n';
    }
    if ((previous && /\s/u.test(previous)) || (next && /\s/u.test(next))) {
        return '';
    }

    return ' ';
};

const shouldSkipFollowingSpace = (replacement: string, previous: string, next: string): boolean => {
    return (replacement === ' ' || Boolean(previous && /[^\S\n]/u.test(previous))) && /[^\S\n]/u.test(next);
};

const readThinkBlock = (
    text: string,
    cursor: number,
    visibleParts: string[],
): { nextCursor: number; reasoning: string | null; replacement: string } | null => {
    THINK_OPEN_PATTERN.lastIndex = cursor;
    const openMatch = THINK_OPEN_PATTERN.exec(text);
    if (openMatch?.index !== cursor) {
        return null;
    }

    const reasoningStart = THINK_OPEN_PATTERN.lastIndex;
    const closeIndex = findThinkCloseIndex(text, reasoningStart);
    const reasoningEnd = closeIndex === -1 ? text.length : closeIndex;
    const normalizedReasoning = normalizeExtractedText(text.slice(reasoningStart, reasoningEnd));
    let nextCursor = closeIndex === -1 ? text.length : closeIndex + THINK_CLOSE_TAG_LENGTH;
    const previous = getLastVisibleChar(visibleParts);
    const replacement = getThinkReplacement(previous, text[nextCursor] ?? '');
    if (shouldSkipFollowingSpace(replacement, previous, text[nextCursor] ?? '')) {
        nextCursor += 1;
    }

    return {
        nextCursor,
        reasoning: normalizedReasoning || null,
        replacement,
    };
};

/**
 * OpenCode can store MiniMax reasoning inline as <think> blocks. Preserve literal
 * examples in Markdown code while extracting model-emitted tags as commentary.
 */
export const splitOpenCodeThinkTaggedText = (text: string): OpenCodeThinkTagText => {
    const reasoningBlocks: string[] = [];
    const visibleParts: string[] = [];
    let cursor = 0;

    while (cursor < text.length) {
        if (text[cursor] === '`') {
            const runLength = getBacktickRunLength(text, cursor);
            const end = findClosingBackticks(text, cursor, runLength);
            visibleParts.push(text.slice(cursor, end));
            cursor = end;
            continue;
        }

        const thinkBlock = readThinkBlock(text, cursor, visibleParts);
        if (thinkBlock) {
            if (thinkBlock.reasoning) {
                reasoningBlocks.push(thinkBlock.reasoning);
            }
            visibleParts.push(thinkBlock.replacement);
            cursor = thinkBlock.nextCursor;
            continue;
        }

        visibleParts.push(text[cursor]!);
        cursor += 1;
    }

    return {
        reasoningBlocks,
        visibleText: normalizeExtractedText(visibleParts.join('')),
    };
};
