import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime } from './formatters';

describe('formatters', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z'));
    });

    it('should format dates using deterministic UTC components', () => {
        expect(formatDateTime('2026-05-24T00:30:00.000Z')).toBe('12:30 AM');
        expect(formatDateTime('2026-05-23T23:30:00.000Z')).toBe('May 23 · 11:30 PM');
    });
});
