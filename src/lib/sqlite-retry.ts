import { isRetryableSqliteError } from './sqlite-error';

const DEFAULT_RETRY_DELAYS_MS = [40, 120, 250] as const;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

type SyncRetryOptions<T> = {
    action: () => T;
    delaysMs?: readonly number[];
    sleep?: (delayMs: number) => void;
};

const sleepSync = (delayMs: number) => {
    if (delayMs <= 0) {
        return;
    }

    Atomics.wait(SLEEP_BUFFER, 0, 0, delayMs);
};

const toRetryExhaustedError = (attemptCount: number, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`SQLite operation failed after ${attemptCount} attempts: ${message}`, {
        cause: error,
    });
};

const shouldRetrySqliteError = (error: unknown, attempt: number, delaysMs: readonly number[]) => {
    return isRetryableSqliteError(error) && attempt < delaysMs.length;
};

export const runWithSqliteRetry = <T>({
    action,
    delaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = sleepSync,
}: SyncRetryOptions<T>): T => {
    let attempt = 0;

    while (true) {
        try {
            return action();
        } catch (error) {
            if (!shouldRetrySqliteError(error, attempt, delaysMs)) {
                if (isRetryableSqliteError(error)) {
                    throw toRetryExhaustedError(attempt + 1, error);
                }
                throw error;
            }

            sleep(delaysMs[attempt] ?? 0);
            attempt += 1;
        }
    }
};
