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

    it('should normalize sort keys only a bounded number of times per inventory entry', () => {
        let timestampReads = 0;
        const entries = Array.from({ length: 4_096 }, (_, index) => {
            const entry = conversation(`thread-${index}`, index);
            Object.defineProperty(entry, 'updatedAtMs', {
                get: () => {
                    timestampReads += 1;
                    return (index * 997) % 4_096;
                },
            });
            return entry;
        });
        expect(paginateConversations(entries, null, 25).data).toHaveLength(25);
        expect(timestampReads).toBeLessThanOrEqual(entries.length * 5);
    });

    it('should match stable full sorting across cursors, duplicate keys, and unusual timestamps', () => {
        const entries = Array.from({ length: 1_000 }, (_, index) =>
            conversation(`thread-${index % 89}`, index % 9 === 0 ? null : ((index * 997) % 101) + 0.5),
        );
        entries.push(
            conversation('nan', Number.NaN),
            conversation('negative', -20),
            conversation('infinity', Infinity),
        );
        const original = [...entries];
        const normalizedTime = (entry: ConversationDetail) =>
            Number.isFinite(entry.updatedAtMs) ? Math.max(0, Math.floor(entry.updatedAtMs ?? 0)) : 0;
        const sorted = [...entries].sort(
            (left, right) =>
                normalizedTime(right) - normalizedTime(left) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        );
        for (const limit of [1, 7, 200, 2_000]) {
            const first = paginateConversations(entries, null, limit);
            expect(first.data).toEqual(sorted.slice(0, limit));
            if (first.meta.nextCursor) {
                const last = first.data.at(-1)!;
                const eligible = sorted.filter(
                    (entry) =>
                        normalizedTime(entry) < normalizedTime(last) ||
                        (normalizedTime(entry) === normalizedTime(last) && entry.id > last.id),
                );
                expect(paginateConversations(entries, first.meta.nextCursor, limit).data).toEqual(
                    eligible.slice(0, limit),
                );
            }
        }
        expect(entries).toEqual(original);
    });
});
