import { describe, expect, it, vi } from 'vitest';
import { DeleteBatchError, requireDeletedItems, runDeleteBatch } from './delete-batch';

describe('runDeleteBatch', () => {
    it('should wait for every deletion before surfacing partial failures', async () => {
        const completed: string[] = [];
        const deleteOne = vi.fn(async (id: string) => {
            await Promise.resolve();
            completed.push(id);
            if (id === 'bad') {
                throw new Error('delete failed');
            }
            return id;
        });

        await expect(runDeleteBatch(['first', 'bad', 'last'], deleteOne)).rejects.toThrow('1 of 3 deletions failed');
        expect(completed.sort()).toEqual(['bad', 'first', 'last']);
    });

    it('should identify failed and successful deletion targets', async () => {
        let caught: unknown;
        try {
            await runDeleteBatch(['first', 'bad', 'last'], async (id) => {
                if (id === 'bad') {
                    throw new Error('delete failed');
                }
                return `${id}-deleted`;
            });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(DeleteBatchError);
        expect(caught).toMatchObject({
            failedIds: ['bad'],
            message: '1 of 3 deletions failed: bad',
            successfulIds: ['first', 'last'],
            successfulResults: ['first-deleted', 'last-deleted'],
        });
    });
});

describe('requireDeletedItems', () => {
    it('should reject missing delete targets consistently', () => {
        expect(() => requireDeletedItems([], 'Kiro session', 'missing')).toThrow('Kiro session not found: missing');
        expect(requireDeletedItems(['present'], 'Kiro session', 'present')).toEqual(['present']);
    });
});
