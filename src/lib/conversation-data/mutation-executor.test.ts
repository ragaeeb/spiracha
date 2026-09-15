import { describe, expect, it } from 'bun:test';
import { MAX_DELETE_BATCH_SIZE, settleDeleteBatch } from './mutation-executor';
import { SourceMutationConflictError } from './operation-types';
import type { DeleteConversationResult } from './types';

const deleted = (id: string, extra: Partial<DeleteConversationResult> = {}): DeleteConversationResult => ({
    deletedFiles: [`/${id}`],
    deletedIds: [id],
    ...extra,
});

describe('settleDeleteBatch', () => {
    it('should reject empty, oversized, and blank ids before invoking any mutator', async () => {
        const deleteOne = async () => {
            throw new Error('must not run');
        };

        await expect(settleDeleteBatch({ concurrency: 1, deleteOne, ids: [] })).rejects.toMatchObject({
            field: 'ids',
            name: 'DeleteBatchValidationError',
        });
        await expect(
            settleDeleteBatch({
                concurrency: 1,
                deleteOne,
                ids: Array.from({ length: MAX_DELETE_BATCH_SIZE + 1 }, () => 'same-id'),
            }),
        ).rejects.toMatchObject({ field: 'ids', name: 'DeleteBatchValidationError' });
        await expect(settleDeleteBatch({ concurrency: 1, deleteOne, ids: ['ok', '  '] })).rejects.toMatchObject({
            field: 'ids',
            name: 'DeleteBatchValidationError',
        });
    });

    it('should mutate each unique id once and disclose duplicate request metadata', async () => {
        const seen: string[] = [];
        const result = await settleDeleteBatch({
            concurrency: 1,
            deleteOne: async (id) => {
                seen.push(id);
                return deleted(id);
            },
            ids: [' two ', 'one', 'two', ' one '],
        });

        expect(seen).toEqual(['two', 'one']);
        expect(result.request).toEqual({
            duplicateCount: 2,
            ids: ['two', 'one', 'two', 'one'],
            uniqueIds: ['two', 'one'],
        });
        expect(result.outcomes).toHaveLength(2);
        expect(result.deletedIds).toEqual(['two', 'one']);
    });

    it('should retain started outcomes when a later item throws and another is missing', async () => {
        const result = await settleDeleteBatch({
            concurrency: 1,
            deleteOne: async (id) => {
                if (id === 'second') {
                    throw new Error('secret-token=/private/store');
                }
                if (id === 'missing') {
                    return { deletedFiles: [], deletedIds: [] };
                }
                return deleted(id);
            },
            ids: ['first', 'second', 'missing'],
        });

        expect(result.outcomes).toEqual([
            {
                affectedIds: ['first'],
                coveredBy: null,
                deletedFiles: ['/first'],
                id: 'first',
                status: 'deleted',
            },
            {
                affectedIds: [],
                deletedFiles: [],
                effect: 'unknown',
                error: {
                    code: 'internal_error',
                    message: 'Conversation delete failed.',
                    operation: 'delete',
                    retryable: false,
                },
                id: 'second',
                receiptId: null,
                status: 'failed',
            },
            { affectedIds: [], deletedFiles: [], id: 'missing', status: 'missing' },
        ]);
        expect(result.summary).toEqual({
            cancelled: 0,
            cleanupPending: 0,
            deleted: 1,
            failed: 1,
            missing: 1,
        });
        expect(result.deletedIds).toEqual(['first']);
        expect(result.missingIds).toEqual(['missing']);
        expect(JSON.stringify(result)).not.toContain('secret-token');
        expect(result.results.map((item) => ({ deleted: item.deleted, id: item.id }))).toEqual([
            { deleted: true, id: 'first' },
            { deleted: false, id: 'second' },
            { deleted: false, id: 'missing' },
        ]);
    });

    it('should map logical commit plus cleanup failures to cleanup_pending with the receipt', async () => {
        const result = await settleDeleteBatch({
            concurrency: 1,
            deleteOne: async () => ({
                cleanupFailures: [{ error: 'unlink failed', path: '/tmp/state', phase: 'files' }],
                deletedFiles: ['/tmp/history'],
                deletedIds: ['session-1'],
                receiptId: 'receipt-session-1',
            }),
            ids: ['session-1'],
        });

        expect(result.outcomes).toEqual([
            {
                affectedIds: ['session-1'],
                deletedFiles: ['/tmp/history'],
                failures: [{ error: 'unlink failed', path: '/tmp/state', phase: 'files' }],
                id: 'session-1',
                receiptId: 'receipt-session-1',
                status: 'cleanup_pending',
            },
        ]);
        expect(result.summary.cleanupPending).toBe(1);
        expect(result.deletedIds).toEqual(['session-1']);
        expect(result.results[0]?.deleted).toBe(true);
    });

    it('should map source mutation conflicts to failed none without dropping sibling success', async () => {
        const result = await settleDeleteBatch({
            concurrency: 1,
            deleteOne: async (id) => {
                if (id === 'locked') {
                    throw new SourceMutationConflictError('qoder', id, 'Qoder is running.', 'writer_running', {
                        process: 'Qoder',
                    });
                }
                return deleted(id);
            },
            ids: ['ok', 'locked'],
        });

        expect(result.outcomes[0]?.status).toBe('deleted');
        expect(result.outcomes[1]).toEqual({
            affectedIds: [],
            deletedFiles: [],
            effect: 'none',
            error: {
                code: 'mutation_conflict',
                details: { process: 'Qoder' },
                message: 'Qoder is running.',
                operation: 'delete',
                retryable: true,
            },
            id: 'locked',
            receiptId: null,
            status: 'failed',
        });
        expect(result.deletedIds).toEqual(['ok']);
    });

    it('should cancel only unstarted ids after abort and keep committed results', async () => {
        const controller = new AbortController();
        const started: string[] = [];
        const result = await settleDeleteBatch({
            concurrency: 1,
            deleteOne: async (id) => {
                started.push(id);
                if (id === 'first') {
                    controller.abort();
                }
                return deleted(id);
            },
            ids: ['first', 'second', 'third'],
            signal: controller.signal,
        });

        expect(started).toEqual(['first']);
        expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['deleted', 'cancelled', 'cancelled']);
        expect(result.summary).toEqual({
            cancelled: 2,
            cleanupPending: 0,
            deleted: 1,
            failed: 0,
            missing: 0,
        });
        expect(result.deletedIds).toEqual(['first']);
    });

    it('should skip a later selected id covered by an earlier cascade and not count it twice', async () => {
        const seen: string[] = [];
        const result = await settleDeleteBatch({
            concurrency: 1,
            deleteOne: async (id) => {
                seen.push(id);
                if (id === 'parent') {
                    return { deletedFiles: ['/parent'], deletedIds: ['parent', 'child'] };
                }
                throw new Error(`unexpected delete of ${id}`);
            },
            ids: ['parent', 'child'],
        });

        expect(seen).toEqual(['parent']);
        expect(result.outcomes).toEqual([
            {
                affectedIds: ['parent', 'child'],
                coveredBy: null,
                deletedFiles: ['/parent'],
                id: 'parent',
                status: 'deleted',
            },
            {
                affectedIds: [],
                coveredBy: 'parent',
                deletedFiles: [],
                id: 'child',
                status: 'deleted',
            },
        ]);
        expect(result.summary.deleted).toBe(2);
        expect(result.deletedIds).toEqual(['parent', 'child']);
        expect(result.results.every((item) => item.deleted)).toBe(true);
    });

    it('should rewrite a concurrent child outcome to coveredBy when the parent cascade is observed', async () => {
        const parentStarted = Promise.withResolvers<void>();
        const childStarted = Promise.withResolvers<void>();
        const result = await settleDeleteBatch({
            concurrency: 2,
            deleteOne: async (id) => {
                if (id === 'parent') {
                    parentStarted.resolve();
                    await childStarted.promise;
                    return { deletedFiles: ['/parent'], deletedIds: ['parent', 'child'] };
                }
                childStarted.resolve();
                await parentStarted.promise;
                return { deletedFiles: [], deletedIds: [] };
            },
            ids: ['parent', 'child'],
        });

        expect(result.outcomes[1]).toMatchObject({ coveredBy: 'parent', id: 'child', status: 'deleted' });
        expect(result.summary.deleted).toBe(2);
        expect(result.deletedIds).toEqual(['parent', 'child']);
    });
});
