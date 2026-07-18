export const runDeleteBatch = async <TId, TResult>(
    ids: TId[],
    deleteOne: (id: TId) => Promise<TResult>,
): Promise<TResult[]> => {
    const settled = await Promise.allSettled(ids.map((id) => deleteOne(id)));
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length > 0) {
        throw new AggregateError(
            failures.map((failure) => failure.reason),
            `${failures.length} of ${ids.length} deletions failed`,
        );
    }

    return settled.map((result) => (result as PromiseFulfilledResult<TResult>).value);
};

export const requireDeletedItems = <T>(deletedIds: T[], label: string, id: string): T[] => {
    if (deletedIds.length === 0) {
        throw new Error(`${label} not found: ${id}`);
    }
    return deletedIds;
};
