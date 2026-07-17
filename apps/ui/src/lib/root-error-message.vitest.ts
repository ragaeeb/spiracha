import { describe, expect, it } from 'vitest';
import { getRootErrorPresentation } from './root-error-message';

describe('root error presentation', () => {
    it('should describe SQLite failures without blaming a specific integration', () => {
        const presentation = getRootErrorPresentation(new Error('SQLITE_BUSY: database is locked'));

        expect(presentation.title).toBe('Database unavailable');
        expect(presentation.description).toContain('local conversation database');
        expect(presentation.description).not.toContain('Codex');
    });

    it('should preserve non-database error messages', () => {
        expect(getRootErrorPresentation(new Error('Unexpected parser failure'))).toEqual({
            description: 'Unexpected parser failure',
            isDatabaseError: false,
            title: 'Something went wrong',
        });
    });
});
