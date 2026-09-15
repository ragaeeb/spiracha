/**
 * Maps with bounded admission and returns results in input order. On a worker
 * failure, stops admitting new items, waits for already admitted work to settle,
 * then throws a rejected worker's error. Completed side effects are not rolled back;
 * this is not cancellation of running callbacks or a transactional batch primitive.
 * Empty input returns []; the concurrency limit is normalized to at least one.
 */
export const mapWithConcurrency = async <T, TResult>(
    values: T[],
    limit: number,
    mapper: (value: T, index: number) => Promise<TResult>,
) => {
    if (values.length === 0) {
        return [];
    }

    const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
    const workerLimit = Math.max(1, requestedLimit);
    const results = new Array<TResult>(values.length);
    let nextIndex = 0;
    let failed = false;

    const worker = async () => {
        while (!failed && nextIndex < values.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            try {
                results[currentIndex] = await mapper(values[currentIndex]!, currentIndex);
            } catch (error) {
                failed = true;
                throw error;
            }
        }
    };

    const settledWorkers = await Promise.allSettled(
        Array.from({ length: Math.min(workerLimit, values.length) }, () => worker()),
    );
    const failure = settledWorkers.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) {
        throw failure.reason;
    }
    return results;
};

export type SettledMapResult<T> =
    | { status: 'fulfilled'; value: T }
    | { status: 'rejected'; reason: unknown }
    | { status: 'cancelled' };

/**
 * Maps with bounded admission and returns every slot in input order. Mapper
 * rejection does not discard sibling results. Abort stops new admissions, awaits
 * started work, and labels only unstarted slots cancelled.
 */
export const mapSettledWithConcurrency = async <T, TResult>(
    values: T[],
    limit: number,
    mapper: (value: T, index: number) => Promise<TResult>,
    signal?: AbortSignal,
): Promise<Array<SettledMapResult<TResult>>> => {
    const results = new Array<SettledMapResult<TResult>>(values.length);
    if (values.length === 0) {
        return results;
    }
    if (signal?.aborted) {
        return values.map(() => ({ status: 'cancelled' as const }));
    }

    const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
    const workerLimit = Math.max(1, requestedLimit);
    let nextIndex = 0;
    let admitting = true;
    const stopAdmitting = () => {
        admitting = false;
    };
    signal?.addEventListener('abort', stopAdmitting, { once: true });

    const worker = async () => {
        while (admitting) {
            const currentIndex = nextIndex;
            if (currentIndex >= values.length) {
                return;
            }
            nextIndex += 1;
            try {
                results[currentIndex] = {
                    status: 'fulfilled',
                    value: await mapper(values[currentIndex]!, currentIndex),
                };
            } catch (reason) {
                results[currentIndex] = { reason, status: 'rejected' };
            }
        }
    };

    try {
        await Promise.all(Array.from({ length: Math.min(workerLimit, values.length) }, () => worker()));
    } finally {
        signal?.removeEventListener('abort', stopAdmitting);
    }

    for (let index = 0; index < results.length; index += 1) {
        results[index] ??= { status: 'cancelled' };
    }
    return results;
};

export type ConcurrencyOptions = {
    signal?: AbortSignal;
    /** Deadline includes time spent queued. Active work retains its slot until settlement. */
    timeoutMs?: number;
};

/**
 * Creates a FIFO limiter with at least one active slot. A submitted task owns its
 * slot until its returned promise settles, including cleanup. Abort/timeout can
 * reject the caller immediately, but cannot forcibly stop active work or release
 * its slot early; tasks must observe their signal and settle after cleanup.
 * A deadline includes queue time. Pre-aborted or canceled queued tasks never run.
 * Do not detach work from the task promise or treat rejection as resource release.
 */
export const createConcurrencyLimiter = (limit: number) => {
    const workerLimit = Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 1);
    const queue = new Set<() => void>();
    let activeCount = 0;

    const drain = () => {
        while (activeCount < workerLimit && queue.size > 0) {
            const next = queue.values().next().value!;
            queue.delete(next);
            next();
        }
    };

    return async <T>(task: (signal: AbortSignal) => Promise<T>, options: ConcurrencyOptions = {}): Promise<T> => {
        if (
            options.timeoutMs !== undefined &&
            (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > 2_147_483_647)
        ) {
            throw new RangeError('timeoutMs must be an integer between 0 and 2147483647.');
        }
        options.signal?.throwIfAborted();
        const controller = new AbortController();
        const { signal } = controller;
        return new Promise<T>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const cleanup = () => {
                clearTimeout(timer);
                options.signal?.removeEventListener('abort', abort);
            };
            const cancel = (reason: unknown) => {
                queue.delete(start);
                controller.abort(reason);
                cleanup();
                reject(signal.reason);
            };
            const abort = () => cancel(options.signal?.reason);
            const start = () => {
                activeCount += 1;
                void Promise.resolve()
                    .then(() => {
                        signal.throwIfAborted();
                        return task(signal);
                    })
                    .then(resolve, reject)
                    .finally(() => {
                        cleanup();
                        activeCount -= 1;
                        drain();
                    });
            };
            options.signal?.addEventListener('abort', abort, { once: true });
            if (options.timeoutMs !== undefined) {
                timer = setTimeout(
                    () => cancel(new DOMException('Task deadline exceeded.', 'TimeoutError')),
                    options.timeoutMs,
                );
            }
            queue.add(start);
            drain();
        });
    };
};
