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

    it('should redact local filesystem paths from generic error details', () => {
        const presentation = getErrorPresentation(
            new Error('Failed to parse /Users/example/private/project/session.jsonl'),
            { fallbackTitle: 'Failed to load transcript' },
        );

        expect(presentation.description).toBe('Failed to parse [local path]');
    });

    it('should preserve web URLs while redacting local paths', () => {
        const presentation = getErrorPresentation(
            new Error('Request to https://example.com/api failed while reading /Users/example/private.txt'),
            { fallbackTitle: 'Load failed' },
        );

        expect(presentation.description).toBe('Request to https://example.com/api failed while reading [local path]');
    });

    it('should present coded non-retryable SQLite errors as database failures', () => {
        const error = Object.assign(new Error('open failed'), { code: 'SQLITE_CANTOPEN' });

        const presentation = getErrorPresentation(error, { fallbackTitle: 'Failed to load transcript' });

        expect(presentation).toMatchObject({ isDatabaseError: true, title: 'Database unavailable' });
    });
});
