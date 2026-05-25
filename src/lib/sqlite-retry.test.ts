import { describe, expect, it } from 'bun:test';
import { isRetryableSqliteError } from './sqlite-error';
import { runWithSqliteRetry } from './sqlite-retry';

describe('sqlite retry helpers', () => {
    it('should classify transient sqlite open errors as retryable', () => {
        expect(isRetryableSqliteError(new Error('unable to open database file'))).toBe(true);
        expect(isRetryableSqliteError(new Error('database is locked'))).toBe(true);
        expect(isRetryableSqliteError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
        expect(isRetryableSqliteError(new Error('SQLITE_CANTOPEN: unable to open database file'))).toBe(true);
        expect(isRetryableSqliteError(new Error('some other error'))).toBe(false);
    });

    it('should retry retryable sqlite failures before succeeding', () => {
        const delays: number[] = [];
        let attempts = 0;

        const result = runWithSqliteRetry({
            action: () => {
                attempts += 1;
                if (attempts < 3) {
                    throw new Error('unable to open database file');
                }
                return 'ok';
            },
            delaysMs: [10, 20],
            sleep: (delayMs) => delays.push(delayMs),
        });

        expect(result).toBe('ok');
        expect(attempts).toBe(3);
        expect(delays).toEqual([10, 20]);
    });

    it('should not retry non-retryable failures', () => {
        let attempts = 0;

        expect(() =>
            runWithSqliteRetry({
                action: () => {
                    attempts += 1;
                    throw new Error('bad sql');
                },
                sleep: () => {},
            }),
        ).toThrow('bad sql');
        expect(attempts).toBe(1);
    });

    it('should stop retrying after the configured retry budget is exhausted', () => {
        let attempts = 0;

        expect(() =>
            runWithSqliteRetry({
                action: () => {
                    attempts += 1;
                    throw new Error('database is locked');
                },
                delaysMs: [1],
                sleep: () => {},
            }),
        ).toThrow('SQLite operation failed after 2 attempts: database is locked');
        expect(attempts).toBe(2);
    });

    it('should tolerate zero-delay retries with the default synchronous sleeper', () => {
        let attempts = 0;

        const result = runWithSqliteRetry({
            action: () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('unable to open database file');
                }

                return 'ok';
            },
            delaysMs: [0],
        });

        expect(result).toBe('ok');
        expect(attempts).toBe(2);
    });
});
