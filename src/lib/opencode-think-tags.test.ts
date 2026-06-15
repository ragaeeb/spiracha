import { describe, expect, it } from 'bun:test';
import { splitOpenCodeThinkTaggedText } from './opencode-think-tags';

describe('splitOpenCodeThinkTaggedText', () => {
    it('should extract think tags from visible assistant text', () => {
        const result = splitOpenCodeThinkTaggedText('<think>\nInternal notes.\n</think>\n\nFinal answer.');

        expect(result.reasoningBlocks).toEqual(['Internal notes.']);
        expect(result.visibleText).toBe('Final answer.');
    });

    it('should preserve literal think tags inside fenced code blocks', () => {
        const result = splitOpenCodeThinkTaggedText(
            [
                'Before',
                '',
                '```html',
                '<think>literal code sample</think>',
                '```',
                '',
                '<think>Internal notes.</think>',
                'After',
            ].join('\n'),
        );

        expect(result.reasoningBlocks).toEqual(['Internal notes.']);
        expect(result.visibleText).toContain('```html\n<think>literal code sample</think>\n```');
        expect(result.visibleText).toContain('Before');
        expect(result.visibleText).toContain('After');
        expect(result.visibleText).not.toContain('<think>Internal notes.</think>');
    });

    it('should preserve literal think tags inside inline code spans', () => {
        const result = splitOpenCodeThinkTaggedText(
            'Document the literal `<think>example</think>` syntax. <think>Internal notes.</think> Done.',
        );

        expect(result.reasoningBlocks).toEqual(['Internal notes.']);
        expect(result.visibleText).toBe('Document the literal `<think>example</think>` syntax. Done.');
    });

    it('should treat an unterminated think tag as reasoning through the end of the text', () => {
        const result = splitOpenCodeThinkTaggedText('Visible.\n<think>\nStill thinking.');

        expect(result.reasoningBlocks).toEqual(['Still thinking.']);
        expect(result.visibleText).toBe('Visible.');
    });
});
