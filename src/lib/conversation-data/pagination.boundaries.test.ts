import { describe, expect, it } from 'bun:test';
import { decodeConversationCursor, paginateConversations } from './pagination';
import { CONVERSATION_SOURCES, type ConversationDetail, type ConversationSource } from './types';

const item = (id: string, updatedAtMs: number | null, source: ConversationSource = 'codex'): ConversationDetail => ({
    createdAtMs: null,
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
    workspacePath: '/fixture',
});
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('pagination edge cases and traversal invariants', () => {
    it('should traverse every tied key exactly once at several page sizes without mutating input', () => {
        const entries = Array.from({ length: 97 }, (_, index) =>
            item(
                `id-${String(index).padStart(3, '0')}`,
                100 - (index % 7),
                CONVERSATION_SOURCES[index % CONVERSATION_SOURCES.length],
            ),
        ).reverse();
        const original = entries.map(({ id }) => id);
        const expected = paginateConversations(entries, null, entries.length).data.map(
            ({ source, id }) => `${source}:${id}`,
        );
        for (const limit of [1, 2, 7, 16, 97, 200]) {
            const collected: string[] = [];
            let next: string | null = null;
            for (let pageIndex = 0; pageIndex <= entries.length; pageIndex += 1) {
                const page = paginateConversations(entries, next, limit);
                collected.push(...page.data.map(({ source, id }) => `${source}:${id}`));
                expect(page.data.length).toBeLessThanOrEqual(limit);
                if (!page.meta.hasNext) {
                    expect(page.meta.nextCursor).toBeNull();
                    break;
                }
                expect(page.meta.nextCursor).not.toBe(next);
                expect(decodeConversationCursor(page.meta.nextCursor)).not.toBeNull();
                next = page.meta.nextCursor;
            }
            expect(collected).toEqual(expected);
            expect(new Set(collected).size).toBe(entries.length);
        }
        expect(entries.map(({ id }) => id)).toEqual(original);
    });

    it('should continue by key even after the cursor row is deleted', () => {
        const entries = [item('a', 30), item('b', 20), item('c', 10)];
        const first = paginateConversations(entries, null, 2);
        const second = paginateConversations([entries[0], entries[2]], first.meta.nextCursor, 2);
        expect(second.data.map(({ id }) => id)).toEqual(['c']);
    });

    it('should distinguish exact-limit completion from one additional row', () => {
        const entries = [item('a', 3), item('b', 2), item('c', 1)];
        expect(paginateConversations(entries, null, 3).meta).toEqual({ hasNext: false, nextCursor: null });
        expect(paginateConversations(entries, null, 2).meta.hasNext).toBe(true);
        expect(paginateConversations([], null, 2)).toEqual({ data: [], meta: { hasNext: false, nextCursor: null } });
    });

    it('should normalize absent, nonfinite and negative timestamps consistently', () => {
        const entries = [
            item('e', Number.NaN),
            item('d', Number.POSITIVE_INFINITY),
            item('c', -1),
            item('b', null),
            item('a', 1.9),
        ];
        const page = paginateConversations(entries, null, 5);
        expect(page.data.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('should accept a valid key for every registered source', () => {
        for (const source of CONVERSATION_SOURCES) {
            expect(decodeConversationCursor(cursor([1, 42, source, 'é/quoted?identifier']))).toEqual({
                id: 'é/quoted?identifier',
                source,
                updatedAtMs: 42,
            });
        }
    });

    it('should reject malformed cursor tuples without guessing a key', () => {
        for (const value of [
            {},
            [],
            [1, 42, 'codex'],
            [1, 42, 'codex', 'id', 'extra'],
            [2, 42, 'codex', 'id'],
            [1, -1, 'codex', 'id'],
            [1, 1.5, 'codex', 'id'],
            [1, Number.MAX_SAFE_INTEGER + 1, 'codex', 'id'],
            [1, 42, 'web', 'id'],
            [1, 42, 'codex', ''],
            [1, 42, 'codex', 'a\0b'],
            [1, 42, 'codex', 42],
        ]) {
            expect(() => decodeConversationCursor(cursor(value))).toThrow(/cursor/u);
        }
    });

    it('should reject invalid limits even for an empty collection', () => {
        for (const limit of [-1, 0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => paginateConversations([], null, limit)).toThrow(/positive integer/u);
        }
    });
});
