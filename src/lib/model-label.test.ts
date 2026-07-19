import { describe, expect, it } from 'bun:test';
import { formatModelLabel } from './model-label';

describe('model label formatting', () => {
    it('should format common model identifiers for display', () => {
        expect(formatModelLabel(null)).toBe('Assistant');
        expect(formatModelLabel('claude-3-7-sonnet')).toBe('Claude 3.7 Sonnet');
        expect(formatModelLabel('gpt-5.4-mini')).toBe('GPT 5.4 Mini');
        expect(formatModelLabel('o3-mini')).toBe('O3 Mini');
    });

    it('should normalize mixed separators without changing numeric versions', () => {
        expect(formatModelLabel('gemini_2.5 pro')).toBe('Gemini 2.5 Pro');
    });
});
