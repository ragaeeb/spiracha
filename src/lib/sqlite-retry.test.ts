import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

    it('should retry retryable sqlite failures before succeeding', async () => {
        const delays: number[] = [];
        let attempts = 0;

        const result = await runWithSqliteRetry({
            action: () => {
                attempts += 1;
                if (attempts < 3) {
                    throw new Error('unable to open database file');
                }
                return 'ok';
            },
            delaysMs: [10, 20],
            sleep: async (delayMs) => {
                delays.push(delayMs);
            },
        });

        expect(result).toBe('ok');
        expect(attempts).toBe(3);
        expect(delays).toEqual([10, 20]);
    });

    it('should report retry details before sleeping', async () => {
        const retries: Array<{ attempt: number; delayMs: number; error: unknown }> = [];
        let attempts = 0;

        expect(
            await runWithSqliteRetry({
                action: () => {
                    attempts += 1;
                    if (attempts === 1) {
                        throw new Error('database is locked');
                    }
                    return 'ok';
                },
                delaysMs: [12],
                onRetry: (details) => retries.push(details),
                sleep: async () => {},
            }),
        ).toBe('ok');

        expect(retries).toEqual([{ attempt: 1, delayMs: 12, error: expect.any(Error) }]);
    });

    it('should not retry non-retryable failures', async () => {
        let attempts = 0;

        await expect(
            runWithSqliteRetry({
                action: () => {
                    attempts += 1;
                    throw new Error('bad sql');
                },
                sleep: async () => {},
            }),
        ).rejects.toThrow('bad sql');
        expect(attempts).toBe(1);
    });

    it('should stop retrying after the configured retry budget is exhausted', async () => {
        let attempts = 0;

        await expect(
            runWithSqliteRetry({
                action: () => {
                    attempts += 1;
                    throw new Error('database is locked');
                },
                delaysMs: [1],
                sleep: async () => {},
            }),
        ).rejects.toThrow('SQLite operation failed after 2 attempts: database is locked');
        expect(attempts).toBe(2);
    });

    it('should tolerate zero-delay retries with the default asynchronous sleeper', async () => {
        let attempts = 0;

        const result = await runWithSqliteRetry({
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

it('should let a timer release a database lock during retry backoff', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sqlite-async-retry-'));
    const dbPath = path.join(directory, 'state.sqlite');
    const writer = new Database(dbPath);
    writer.exec('CREATE TABLE values_table(value INTEGER); BEGIN EXCLUSIVE; INSERT INTO values_table VALUES (42)');
    let progressed = false;
    let attempts = 0;
    const timer = setTimeout(() => {
        writer.exec('COMMIT');
        progressed = true;
    }, 5);
    try {
        const result = await runWithSqliteRetry({
            action: () => {
                attempts += 1;
                const reader = new Database(dbPath, { readonly: true });
                try {
                    reader.exec('PRAGMA busy_timeout = 0');
                    return reader.query('SELECT value FROM values_table').get();
                } finally {
                    reader.close();
                }
            },
            delaysMs: [20, 40, 80],
        });
        expect(progressed).toBe(true);
        expect(attempts).toBeGreaterThan(1);
        expect(result).toEqual({ value: 42 });
    } finally {
        clearTimeout(timer);
        writer.close();
        await rm(directory, { force: true, recursive: true });
    }
});

it('should retain typed errors and the original cause after retry exhaustion', async () => {
    const permanent = new TypeError('invalid query');
    await expect(
        runWithSqliteRetry({
            action: () => {
                throw permanent;
            },
        }),
    ).rejects.toBe(permanent);
    const transient = Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
    const result = runWithSqliteRetry({
        action: () => {
            throw transient;
        },
        delaysMs: [],
    });
    await expect(result).rejects.toMatchObject({
        cause: transient,
        message: 'SQLite operation failed after 1 attempts: busy',
    });
});
