import { isRetryableSqliteError } from './sqlite-error';

const DEFAULT_RETRY_DELAYS_MS = [40, 120, 250] as const;

type RetryOptions<T> = {
    action: () => T;
    delaysMs?: readonly number[];
    onRetry?: (details: { attempt: number; delayMs: number; error: unknown }) => void;
    sleep?: (delayMs: number) => Promise<unknown>;
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

/**
 * Retries recognized SQLite busy/locked failures with asynchronous backoff; default
 * delays 40/120/250 ms permit four total attempts. Non-retryable failures rethrow;
 * exhausted retryable failures are wrapped with their original error as cause.
 * Callers should perform each database operation synchronously and close/release
 * its resources before returning or throwing, so no handle/transaction is held
 * across backoff. The helper awaits action but does not enforce that obligation.
 */
export const runWithSqliteRetry = async <T>({
    action,
    delaysMs = DEFAULT_RETRY_DELAYS_MS,
    onRetry,
    sleep = Bun.sleep,
}: RetryOptions<T>): Promise<T> => {
    let attempt = 0;

    while (true) {
        try {
            return await action();
        } catch (error) {
            if (!shouldRetrySqliteError(error, attempt, delaysMs)) {
                if (isRetryableSqliteError(error)) {
                    throw toRetryExhaustedError(attempt + 1, error);
                }
                throw error;
            }

            const delayMs = delaysMs[attempt] ?? 0;
            onRetry?.({ attempt: attempt + 1, delayMs, error });
            await sleep(delayMs);
            attempt += 1;
        }
    }
};
