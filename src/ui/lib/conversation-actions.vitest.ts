import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
    applySettledDeleteSelection,
    canBeginConversationOperation,
    retryableDeleteIds,
    snapshotConversationAction,
    useConversationActions,
} from './conversation-actions';

describe('conversation actions', () => {
    it('should snapshot ids and options so later row changes cannot retarget the request', () => {
        const ids = ['session-1', 'session-2'];
        const options = { deleteSessionFiles: false, scope: 'selected' };
        const request = snapshotConversationAction('command-code:ws', ids, options);
        ids.splice(0, ids.length, 'session-3');
        options.scope = 'all';
        options.deleteSessionFiles = true;

        expect(request).toEqual({
            ids: ['session-1', 'session-2'],
            inventoryIdentity: 'command-code:ws',
            operationId: request?.operationId,
            options: { deleteSessionFiles: false, scope: 'selected' },
        });
        expect(Object.isFrozen(request?.ids)).toBe(true);
        expect(Object.isFrozen(request?.options)).toBe(true);
    });

    it('should reject an empty selection and a second submit while an operation is in flight', () => {
        expect(snapshotConversationAction('grok-bot', [], { kind: 'delete' })).toBeNull();
        expect(canBeginConversationOperation(null, [])).toBe(false);
        expect(canBeginConversationOperation('op-1', ['chat-1'])).toBe(false);
        expect(canBeginConversationOperation(null, ['chat-1'])).toBe(true);
    });

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

    it('should confirm one immutable request and ignore a duplicate submit until it settles', () => {
        const { result } = renderHook(() => useConversationActions('web'));

        let operationId: string | null = null;
        act(() => {
            const request = result.current.confirm(['parsed-id'], { format: 'md' as const });
            expect(request?.ids).toEqual(['parsed-id']);
            operationId = request?.operationId ?? null;
        });
        expect(result.current.inFlightOperationId).toBe(operationId);

        act(() => {
            expect(result.current.confirm(['parsed-id', 'other'], { format: 'txt' as const })).toBeNull();
        });

        act(() => {
            result.current.settle(operationId!);
        });
        expect(result.current.inFlightOperationId).toBeNull();

        act(() => {
            expect(result.current.confirm([], { format: 'md' })).toBeNull();
        });
    });

    it('should cancel an in-flight confirmation without starting another mutation', () => {
        const { result } = renderHook(() => useConversationActions('command-code:ws'));

        act(() => {
            result.current.confirm(['session-1'], { kind: 'delete' });
        });
        act(() => {
            result.current.cancel();
        });

        expect(result.current.inFlightOperationId).toBeNull();
        act(() => {
            expect(result.current.confirm(['session-1'], { kind: 'delete' })?.ids).toEqual(['session-1']);
        });
    });
});
