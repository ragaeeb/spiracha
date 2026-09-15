import { mapSettledWithConcurrency } from '../concurrency';
import { type PublicMutationError, SourceMutationConflictError } from './operation-types';
import type {
    DeleteBatchSummary,
    DeleteConversationItemResult,
    DeleteConversationResult,
    DeleteConversationsResult,
    DeleteOutcome,
} from './types';

export const MAX_DELETE_BATCH_SIZE = 200;
export const MAX_DELETE_ID_LENGTH = 2048;

export class DeleteBatchValidationError extends Error {
    readonly field: string;

    constructor(message: string, field = 'ids') {
        super(message);
        this.field = field;
        this.name = 'DeleteBatchValidationError';
    }
}

const uniquePush = (values: string[], seen: Set<string>, id: string) => {
    if (!seen.has(id)) {
        seen.add(id);
        values.push(id);
    }
};

const trimRequestedIds = (ids: string[]): string[] => {
    if (ids.length === 0) {
        throw new DeleteBatchValidationError('`ids` must be a non-empty array of explicit ids.');
    }
    if (ids.length > MAX_DELETE_BATCH_SIZE) {
        throw new DeleteBatchValidationError(`\`ids\` cannot include more than ${MAX_DELETE_BATCH_SIZE} ids.`);
    }

    return ids.map((id, index) => {
        const trimmed = id.trim();
        if (!trimmed || trimmed.length > MAX_DELETE_ID_LENGTH) {
            throw new DeleteBatchValidationError(`\`ids[${index}]\` is invalid.`);
        }
        return trimmed;
    });
};

const uniqueIdsInOrder = (ids: string[]): string[] => {
    const uniqueIds: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
        uniquePush(uniqueIds, seen, id);
    }
    return uniqueIds;
};

export const toPublicMutationError = (error: unknown): PublicMutationError => {
    if (error instanceof SourceMutationConflictError) {
        return {
            code: 'mutation_conflict',
            details: error.details,
            message: error.message,
            operation: 'delete',
            retryable: true,
        };
    }
    return {
        code: 'internal_error',
        message: 'Conversation delete failed.',
        operation: 'delete',
        retryable: false,
    };
};

const failedOutcome = (id: string, error: unknown, effect: 'none' | 'partial' | 'unknown'): DeleteOutcome => ({
    affectedIds: [],
    deletedFiles: [],
    effect,
    error: toPublicMutationError(error),
    id,
    receiptId: null,
    status: 'failed',
});

const coveredOutcome = (id: string, covering: string): DeleteOutcome => ({
    affectedIds: [],
    coveredBy: covering,
    deletedFiles: [],
    id,
    status: 'deleted',
});

const cancelledOutcome = (id: string): DeleteOutcome => ({
    affectedIds: [],
    deletedFiles: [],
    id,
    status: 'cancelled',
});

const providerResultToOutcome = (id: string, result: DeleteConversationResult): DeleteOutcome => {
    if (result.cleanupFailures?.length) {
        if (result.receiptId) {
            return {
                affectedIds: result.deletedIds,
                deletedFiles: result.deletedFiles,
                failures: result.cleanupFailures,
                id,
                receiptId: result.receiptId,
                status: 'cleanup_pending',
            };
        }
        return {
            affectedIds: result.deletedIds,
            deletedFiles: result.deletedFiles,
            effect: result.deletedIds.length > 0 || result.deletedFiles.length > 0 ? 'partial' : 'unknown',
            error: {
                code: 'cleanup_failed',
                message: result.cleanupFailures[0]?.error ?? 'Cleanup failed after delete.',
                operation: 'delete',
                retryable: true,
            },
            id,
            receiptId: null,
            status: 'failed',
        };
    }
    if (result.deletedIds.length > 0) {
        return {
            affectedIds: result.deletedIds,
            coveredBy: null,
            deletedFiles: result.deletedFiles,
            id,
            status: 'deleted',
        };
    }
    return { affectedIds: [], deletedFiles: [], id, status: 'missing' };
};

const recordCoverage = (coverage: Map<string, string>, requestedId: string, affectedIds: string[]) => {
    for (const affectedId of affectedIds) {
        if (affectedId !== requestedId && !coverage.has(affectedId)) {
            coverage.set(affectedId, requestedId);
        }
    }
};

const applyCascadeCoverage = (outcomes: DeleteOutcome[]): DeleteOutcome[] => {
    const coverage = new Map<string, string>();
    for (const outcome of outcomes) {
        if (outcome.status === 'deleted' || outcome.status === 'cleanup_pending') {
            recordCoverage(coverage, outcome.id, outcome.affectedIds);
        }
    }
    return outcomes.map((outcome) => {
        const covering = coverage.get(outcome.id);
        if (!covering || outcome.status === 'cancelled' || covering === outcome.id) {
            return outcome;
        }
        return coveredOutcome(outcome.id, covering);
    });
};

const itemResultFromOutcome = (outcome: DeleteOutcome): DeleteConversationItemResult => {
    const deleted = outcome.status === 'deleted' || outcome.status === 'cleanup_pending';
    const cleanup =
        outcome.status === 'cleanup_pending' ? { cleanupFailures: outcome.failures, receiptId: outcome.receiptId } : {};
    return {
        ...cleanup,
        deleted,
        deletedFiles: outcome.deletedFiles,
        deletedIds: outcome.status === 'deleted' || outcome.status === 'cleanup_pending' ? outcome.affectedIds : [],
        id: outcome.id,
    };
};

const countByStatus = (outcomes: DeleteOutcome[]): DeleteBatchSummary => ({
    cancelled: outcomes.filter((outcome) => outcome.status === 'cancelled').length,
    cleanupPending: outcomes.filter((outcome) => outcome.status === 'cleanup_pending').length,
    deleted: outcomes.filter((outcome) => outcome.status === 'deleted').length,
    failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
    missing: outcomes.filter((outcome) => outcome.status === 'missing').length,
});

const idsFromOutcome = (outcome: DeleteOutcome, includeFailed: boolean): string[] => {
    if (outcome.status === 'deleted' || outcome.status === 'cleanup_pending') {
        return outcome.affectedIds.length > 0 ? outcome.affectedIds : [outcome.id];
    }
    return includeFailed && outcome.status === 'failed' ? outcome.affectedIds : [];
};

const collectIds = (outcomes: DeleteOutcome[], includeFailed: boolean): string[] => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const outcome of outcomes) {
        for (const id of idsFromOutcome(outcome, includeFailed)) {
            uniquePush(ids, seen, id);
        }
    }
    return ids;
};

export type SettleDeleteBatchOptions = {
    concurrency: number;
    deleteOne: (id: string) => Promise<DeleteConversationResult>;
    ids: string[];
    signal?: AbortSignal;
};

export const settleDeleteBatch = async (options: SettleDeleteBatchOptions): Promise<DeleteConversationsResult> => {
    const requestedIds = trimRequestedIds(options.ids);
    const uniqueIds = uniqueIdsInOrder(requestedIds);
    const coverage = new Map<string, string>();

    const settled = await mapSettledWithConcurrency(
        uniqueIds,
        options.concurrency,
        async (id) => {
            const covering = coverage.get(id);
            if (covering) {
                return coveredOutcome(id, covering);
            }
            try {
                const outcome = providerResultToOutcome(id, await options.deleteOne(id));
                if (outcome.status === 'deleted' || outcome.status === 'cleanup_pending') {
                    recordCoverage(coverage, id, outcome.affectedIds);
                }
                return outcome;
            } catch (error) {
                return failedOutcome(id, error, error instanceof SourceMutationConflictError ? 'none' : 'unknown');
            }
        },
        options.signal,
    );

    const outcomes = applyCascadeCoverage(
        uniqueIds.map((id, index) => {
            const slot = settled[index];
            if (!slot || slot.status === 'cancelled') {
                return cancelledOutcome(id);
            }
            if (slot.status === 'rejected') {
                return failedOutcome(id, slot.reason, 'unknown');
            }
            return slot.value;
        }),
    );
    const results = outcomes.map(itemResultFromOutcome);
    const cleanupFailures = outcomes.flatMap((outcome) =>
        outcome.status === 'cleanup_pending' ? outcome.failures : [],
    );
    const deletedIds = collectIds(outcomes, false);
    const affectedIds = collectIds(outcomes, true);

    return {
        ...(cleanupFailures.length > 0 ? { cleanupFailures } : {}),
        affectedIds,
        deletedFiles: [...new Set(outcomes.flatMap((outcome) => outcome.deletedFiles))],
        deletedIds,
        missingIds: outcomes.filter((outcome) => outcome.status === 'missing').map((outcome) => outcome.id),
        outcomes,
        request: {
            duplicateCount: requestedIds.length - uniqueIds.length,
            ids: requestedIds,
            uniqueIds,
        },
        results,
        summary: countByStatus(outcomes),
    };
};
