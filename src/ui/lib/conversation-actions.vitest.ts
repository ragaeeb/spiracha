import { describe, expect, it } from 'vitest';
import { applySettledDeleteSelection, retryableDeleteIds } from './conversation-actions';

describe('conversation actions', () => {
    it('should keep failed and cleanup-pending ids selected after a mixed batch delete', () => {
        expect(
            applySettledDeleteSelection(
                ['ok', 'gone', 'fail', 'pending'],
                [
                    { id: 'ok', status: 'deleted' },
                    { id: 'gone', status: 'missing' },
                    { id: 'fail', status: 'failed' },
                    { id: 'pending', status: 'cleanup_pending' },
                ],
            ),
        ).toEqual(['fail', 'pending']);
        expect(
            retryableDeleteIds([
                { id: 'ok', status: 'deleted' },
                { id: 'fail', status: 'failed' },
                { id: 'pending', status: 'cleanup_pending' },
            ]),
        ).toEqual(['fail', 'pending']);
    });
});
