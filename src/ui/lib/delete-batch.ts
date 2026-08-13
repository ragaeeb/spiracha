export class DeleteBatchError<TId, TResult> extends AggregateError {
    readonly failedIds: TId[];
    readonly successfulIds: TId[];
    readonly successfulResults: TResult[];

    constructor(
        failures: Array<{ id: TId; reason: unknown }>,
        successes: Array<{ id: TId; result: TResult }>,
        totalCount: number,
    ) {
        const visibleFailedIds = failures.slice(0, 5).map((failure) => String(failure.id));
        const omittedFailedIdCount = failures.length - visibleFailedIds.length;
        const failedIdSummary = `${visibleFailedIds.join(', ')}${omittedFailedIdCount > 0 ? ` (+${omittedFailedIdCount} more)` : ''}`;
        super(
            failures.map((failure) => failure.reason),
            `${failures.length} of ${totalCount} deletions failed: ${failedIdSummary}`,
        );
        this.name = 'DeleteBatchError';
        this.failedIds = failures.map((failure) => failure.id);
        this.successfulIds = successes.map((success) => success.id);
        this.successfulResults = successes.map((success) => success.result);
    }
}

export const runDeleteBatch = async <TId, TResult>(
    ids: TId[],
    deleteOne: (id: TId) => Promise<TResult>,
): Promise<TResult[]> => {
    const settled = await Promise.allSettled(ids.map((id) => deleteOne(id)));
    const failures: Array<{ id: TId; reason: unknown }> = [];
    const successes: Array<{ id: TId; result: TResult }> = [];
    for (const [index, result] of settled.entries()) {
        const id = ids[index]!;
        if (result.status === 'rejected') {
            failures.push({ id, reason: result.reason });
        } else {
            successes.push({ id, result: result.value });
        }
    }
    if (failures.length > 0) {
        throw new DeleteBatchError(failures, successes, ids.length);
    }

    return successes.map((success) => success.result);
};

export const requireDeletedItems = <T>(deletedIds: T[], label: string, id: string): T[] => {
    if (deletedIds.length === 0) {
        throw new Error(`${label} not found: ${id}`);
    }
    return deletedIds;
};
