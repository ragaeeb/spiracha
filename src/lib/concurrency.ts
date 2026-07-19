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

export const createConcurrencyLimiter = (limit: number) => {
    const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
    const workerLimit = Math.max(1, requestedLimit);
    const queue: Array<() => void> = [];
    let activeCount = 0;

    const drain = () => {
        if (activeCount >= workerLimit) {
            return;
        }

        const next = queue.shift();
        if (next) {
            next();
        }
    };

    return async <T>(task: () => Promise<T>): Promise<T> => {
        await new Promise<void>((resolve) => {
            const start = () => {
                activeCount += 1;
                resolve();
            };

            if (activeCount < workerLimit) {
                start();
                return;
            }

            queue.push(start);
        });

        try {
            return await task();
        } finally {
            activeCount -= 1;
            drain();
        }
    };
};
