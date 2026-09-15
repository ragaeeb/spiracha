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

export type ConcurrencyOptions = {
    signal?: AbortSignal;
    /** Deadline includes time spent queued. Active work retains its slot until settlement. */
    timeoutMs?: number;
};

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
