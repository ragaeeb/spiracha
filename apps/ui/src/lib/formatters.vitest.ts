import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    formatBooleanLabel,
    formatBytes,
    formatDateTime,
    formatList,
    formatModelLabel,
    formatPercent,
    formatTokens,
} from './formatters';

describe('formatters', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z'));
    });

    it('should format dates in the user timezone instead of UTC', () => {
        expect(
            formatDateTime('2026-05-24T12:30:00.000Z', {
                now: new Date('2026-05-24T12:00:00.000Z'),
                timeZone: 'America/Toronto',
            }),
        ).toBe('8:30 AM');
        expect(
            formatDateTime('2026-05-24T00:30:00.000Z', {
                now: new Date('2026-05-24T12:00:00.000Z'),
                timeZone: 'America/Toronto',
            }),
        ).toBe('May 23 · 8:30 PM');
    });

    it('should include the year for dates outside the current calendar year', () => {
        expect(
            formatDateTime('2025-05-23T00:30:00.000Z', {
                now: new Date('2026-05-24T12:00:00.000Z'),
                timeZone: 'America/Toronto',
            }),
        ).toBe('May 22, 2025 · 8:30 PM');
    });

    it('should format supporting display primitives', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatTokens(1200)).toBe('1,200 tokens');
        expect(formatList([])).toBe('n/a');
        expect(formatList(['gpt-5.4', 'gpt-5.5'])).toBe('gpt-5.4, gpt-5.5');
        expect(formatPercent(2, 8)).toBe('25%');
        expect(formatPercent(0, 0)).toBe('0%');
        expect(formatBooleanLabel(true)).toBe('Yes');
        expect(formatBooleanLabel(false)).toBe('No');
        expect(formatModelLabel(null)).toBe('Assistant');
        expect(formatModelLabel('gpt-5.4')).toBe('GPT 5.4');
        expect(formatDateTime('not-a-date')).toBe('n/a');
    });
});
