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

    const worker = async () => {
        while (nextIndex < values.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(values[currentIndex]!, currentIndex);
        }
    };

    await Promise.all(Array.from({ length: Math.min(workerLimit, values.length) }, () => worker()));
    return results;
};
