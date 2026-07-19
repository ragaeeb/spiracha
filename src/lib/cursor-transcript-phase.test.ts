import { describe, expect, it } from 'bun:test';
import type { CursorBubble } from './cursor-exporter-types';
import { getCursorTextBubblePhase, getFinalCursorAssistantTextBubbleIds } from './cursor-transcript-phase';

const bubble = (bubbleId: string, kind: CursorBubble['kind'], text: string): CursorBubble => ({
    bubbleId,
    createdAtMs: null,
    kind,
    text,
    thinking: null,
    toolCall: null,
});

describe('Cursor transcript phase classification', () => {
    it('should select the last assistant text in each turn as final', () => {
        const bubbles = [
            bubble('assistant-progress', 'assistant', 'Checking the project.'),
            bubble('assistant-answer', 'assistant', 'First answer.'),
            bubble('user-follow-up', 'user', 'Please continue.'),
            bubble('assistant-final', 'assistant', 'Second answer.'),
        ];

        const finalIds = getFinalCursorAssistantTextBubbleIds(bubbles);

        expect([...finalIds]).toEqual(['assistant-answer', 'assistant-final']);
        expect(getCursorTextBubblePhase(bubbles[0]!, finalIds)).toBe('commentary');
        expect(getCursorTextBubblePhase(bubbles[1]!, finalIds)).toBe('final_answer');
        expect(getCursorTextBubblePhase(bubbles[2]!, finalIds)).toBeNull();
        expect(getCursorTextBubblePhase(bubbles[3]!, finalIds)).toBe('final_answer');
    });

    it('should ignore empty assistant bubbles when selecting a final answer', () => {
        const bubbles = [bubble('empty', 'assistant', '   '), bubble('answer', 'assistant', 'Done.')];

        expect([...getFinalCursorAssistantTextBubbleIds(bubbles)]).toEqual(['answer']);
    });
});
