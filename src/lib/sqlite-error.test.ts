import { describe, expect, it } from 'bun:test';
import { isRetryableSqliteError, isSqliteDatabaseError } from './sqlite-error';

describe('retryable SQLite error detection', () => {
    it('should recognize supported transient SQLite failures', () => {
        for (const message of ['database is locked', 'database table is locked', 'SQLITE_BUSY: retry later']) {
            expect(isRetryableSqliteError(new Error(message))).toBe(true);
        }

        const codedError = Object.assign(new Error('operation failed'), { code: 'SQLITE_BUSY_SNAPSHOT' });
        expect(isRetryableSqliteError(codedError)).toBe(true);
    });

    it('should reject unrelated errors and non-error values', () => {
        expect(isRetryableSqliteError(new Error('SQLITE_CORRUPT'))).toBe(false);
        expect(isRetryableSqliteError(new Error('user text says database is locked forever'))).toBe(false);
        expect(isRetryableSqliteError(new Error('unable to open database file'))).toBe(true);
        expect(isRetryableSqliteError('database is locked')).toBe(false);
    });

    it('should classify non-retryable SQLite availability errors separately', () => {
        expect(isSqliteDatabaseError(Object.assign(new Error('failed'), { code: 'SQLITE_CANTOPEN' }))).toBe(true);
        expect(
            isSqliteDatabaseError(new Error('SQLite operation failed after 1 attempt: unable to open database file')),
        ).toBe(true);
        expect(isSqliteDatabaseError(new Error('Unexpected parser failure'))).toBe(false);
    });
});
