import { describe, expect, it } from 'vitest';
import { getErrorPresentation } from './error-presentation';

describe('error presentation', () => {
    it('should describe SQLite failures without blaming a specific integration', () => {
        const presentation = getErrorPresentation(new Error('SQLITE_BUSY: database is locked'), {
            fallbackTitle: 'Failed to load Codex',
        });

        expect(presentation.title).toBe('Database unavailable');
        expect(presentation.description).toContain('local conversation database');
        expect(presentation.description).not.toContain('Codex');
    });

    it('should preserve route-specific titles and non-database error messages', () => {
        expect(
            getErrorPresentation(new Error('Unexpected parser failure'), {
                fallbackTitle: 'Failed to load Claude Code',
            }),
        ).toEqual({
            description: 'Unexpected parser failure',
            isDatabaseError: false,
            title: 'Failed to load Claude Code',
        });
    });
});
