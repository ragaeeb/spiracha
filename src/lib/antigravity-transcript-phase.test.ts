import { describe, expect, it } from 'bun:test';
import { getAntigravityAssistantPhase, getFinalAntigravityAssistantSequences } from './antigravity-transcript-phase';

describe('Antigravity transcript phase classification', () => {
    it('should keep tool-leading assistant content as commentary and select the later final response', () => {
        const finalSequences = getFinalAntigravityAssistantSequences([
            { hasContent: true, hasToolCalls: false, role: 'user', sequence: 0 },
            { hasContent: true, hasToolCalls: true, role: 'assistant', sequence: 1 },
            { hasContent: true, hasToolCalls: false, role: 'other', sequence: 2 },
            { hasContent: true, hasToolCalls: false, role: 'assistant', sequence: 3 },
        ]);

        expect(getAntigravityAssistantPhase(1, finalSequences)).toBe('commentary');
        expect(getAntigravityAssistantPhase(3, finalSequences)).toBe('final_answer');
    });

    it('should select one final assistant response for each user turn', () => {
        const finalSequences = getFinalAntigravityAssistantSequences([
            { hasContent: true, hasToolCalls: false, role: 'assistant', sequence: 0 },
            { hasContent: true, hasToolCalls: false, role: 'user', sequence: 1 },
            { hasContent: true, hasToolCalls: false, role: 'assistant', sequence: 2 },
        ]);

        expect([...finalSequences]).toEqual([0, 2]);
    });
});
