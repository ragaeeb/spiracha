import { describe, expect, it } from 'bun:test';
import { paginateConversations } from './pagination';
import type { ConversationDetail, ConversationSource } from './types';

const conversation = (id: string, updatedAtMs: number | null, source: ConversationSource = 'codex') =>
    ({
        createdAtMs: updatedAtMs,
        deepLinks: { native: null, spiracha: `spiracha://conversation/${source}/${id}`, ui: `/${id}` },
        id,
        matches: [],
        messageCount: 0,
        messages: [],
        metadata: {},
        source,
        title: id,
        updatedAtMs,
        workspaceKey: null,
        workspacePath: '/repo',
    }) satisfies ConversationDetail;

describe('conversation keyset pagination', () => {
    it('should continue after the last sort key when newer conversations arrive', () => {
        const initial = [conversation('three', 300), conversation('two', 200), conversation('one', 100)];
        const first = paginateConversations(initial, null, 2);
        const second = paginateConversations([conversation('four', 400), ...initial], first.meta.nextCursor, 2);

        expect(first.data.map(({ id }) => id)).toEqual(['three', 'two']);
        expect(second.data.map(({ id }) => id)).toEqual(['one']);
        expect(second.meta).toEqual({ hasNext: false, nextCursor: null });
    });

    it('should use source and id as deterministic tie breakers', () => {
        const entries = [
            conversation('zeta', 100, 'codex'),
            conversation('alpha', 100, 'codex'),
            conversation('alpha', 100, 'claude-code'),
        ];
        const first = paginateConversations(entries, null, 1);
        const second = paginateConversations(entries, first.meta.nextCursor, 2);

        expect(first.data.map(({ source, id }) => `${source}:${id}`)).toEqual(['claude-code:alpha']);
        expect(second.data.map(({ source, id }) => `${source}:${id}`)).toEqual(['codex:alpha', 'codex:zeta']);
    });

    it('should reject malformed and obsolete offset cursors', () => {
        expect(() => paginateConversations([], Buffer.from('12').toString('base64url'), 10)).toThrow(
            'Invalid conversation pagination cursor.',
        );
        expect(() => paginateConversations([], 'not-base64', 10)).toThrow('Invalid conversation pagination cursor.');
        expect(() => paginateConversations([], 'x'.repeat(2_049), 10)).toThrow(
            'Invalid conversation pagination cursor.',
        );
        expect(() => paginateConversations([conversation('one', 1)], null, 0)).toThrow(
            'Conversation pagination limit must be a positive integer.',
        );
    });
});
