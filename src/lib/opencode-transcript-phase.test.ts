import { describe, expect, it } from 'bun:test';
import type { OpenCodeTranscriptPart } from './opencode-exporter-types';
import { getFinalOpenCodeAssistantTextPartIds, getOpenCodeTextPartPhase } from './opencode-transcript-phase';

const part = (
    partId: string,
    role: string,
    type: OpenCodeTranscriptPart['type'],
    text?: string,
): OpenCodeTranscriptPart => ({
    createdAtMs: 0,
    messageId: `${role}:${partId}`,
    partId,
    raw: { type },
    role,
    text,
    type,
    updatedAtMs: 0,
});

describe('opencode transcript phase helpers', () => {
    it('should mark the last visible assistant text before each user turn as final answer', () => {
        const parts = [
            part('u1', 'user', 'text', 'Task one'),
            part('a1', 'assistant', 'text', "I'll inspect files."),
            part('a2', 'assistant', 'text', 'Task one complete.'),
            part('u2', 'user', 'text', 'Task two'),
            part('a3', 'assistant', 'text', 'Checking context.'),
            part('a4', 'assistant', 'text', 'Task two complete.'),
        ];
        const finalIds = getFinalOpenCodeAssistantTextPartIds(parts);

        expect([...finalIds].sort()).toEqual(['a2', 'a4']);
        expect(getOpenCodeTextPartPhase(parts[1]!, finalIds)).toBe('commentary');
        expect(getOpenCodeTextPartPhase(parts[2]!, finalIds)).toBe('final_answer');
        expect(getOpenCodeTextPartPhase(parts[4]!, finalIds)).toBe('commentary');
        expect(getOpenCodeTextPartPhase(parts[5]!, finalIds)).toBe('final_answer');
    });

    it('should ignore think-only assistant text when choosing final answers', () => {
        const parts = [
            part('u1', 'user', 'text', 'Task'),
            part('a1', 'assistant', 'text', '<think>Internal notes.</think>'),
            part('a2', 'assistant', 'text', 'Visible final answer.'),
        ];

        expect([...getFinalOpenCodeAssistantTextPartIds(parts)]).toEqual(['a2']);
    });

    it('should not mark pre-tool assistant text as a final answer without later visible text', () => {
        const parts = [
            part('u1', 'user', 'text', 'Task'),
            part('a1', 'assistant', 'text', "I'll run a tool."),
            part('tool1', 'assistant', 'tool'),
        ];

        expect([...getFinalOpenCodeAssistantTextPartIds(parts)]).toEqual([]);
    });
});
