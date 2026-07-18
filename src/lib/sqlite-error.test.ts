import { describe, expect, it } from 'bun:test';
import { isRetryableSqliteError } from './sqlite-error';

describe('retryable SQLite error detection', () => {
    it('should recognize supported transient SQLite failures', () => {
        for (const message of [
            'unable to open database',
            'unable to open database file',
            'database is locked',
            'SQLITE_BUSY: retry later',
            'SQLITE_CANTOPEN: missing database',
        ]) {
            expect(isRetryableSqliteError(new Error(message))).toBe(true);
        }
    });

    it('should reject unrelated errors and non-error values', () => {
        expect(isRetryableSqliteError(new Error('SQLITE_CORRUPT'))).toBe(false);
        expect(isRetryableSqliteError('database is locked')).toBe(false);
    });
});
