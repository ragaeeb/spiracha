import { describe, expect, it } from 'vitest';
import { applySettledDeleteSelection, retryableDeleteIds } from '#/lib/conversation-actions';

describe('Grok Bot index settled delete', () => {
    it('should drop already-deleted ids and keep only pending cleanup on retry of the original selection', () => {
        const originalSelection = ['gone', 'pending', 'ok'];
        const firstPass = [
            { id: 'gone', status: 'deleted' as const },
            { id: 'pending', status: 'cleanup_pending' as const },
            { id: 'ok', status: 'deleted' as const },
        ];
        expect(applySettledDeleteSelection(originalSelection, firstPass)).toEqual(['pending']);
        expect(retryableDeleteIds(firstPass)).toEqual(['pending']);

        const retryPass = [{ id: 'pending', status: 'deleted' as const }];
        expect(retryableDeleteIds(retryPass)).toEqual([]);
        expect(applySettledDeleteSelection(['pending'], retryPass)).toEqual([]);
    });
});
