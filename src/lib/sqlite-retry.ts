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

export const runWithSqliteRetry = async <T>({
    action,
    delaysMs = DEFAULT_RETRY_DELAYS_MS,
    onRetry,
    sleep = Bun.sleep,
}: RetryOptions<T>): Promise<T> => {
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

            const delayMs = delaysMs[attempt] ?? 0;
            onRetry?.({ attempt: attempt + 1, delayMs, error });
            await sleep(delayMs);
            attempt += 1;
        }
    }
};
