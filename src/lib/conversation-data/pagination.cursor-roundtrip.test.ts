import { describe, expect, it } from 'bun:test';
import { decodeConversationCursor, paginateConversations } from './pagination';
import type { ConversationDetail } from './types';

const item = (id: string, updatedAtMs: number): ConversationDetail => ({
    createdAtMs: null,
    deepLinks: { native: null, spiracha: `spiracha://conversation/codex/${id}`, ui: '/fixture' },
    id,
    matches: [],
    messageCount: 0,
    messages: [],
    metadata: {},
    source: 'codex',
    title: null,
    updatedAtMs,
    workspaceKey: null,
    workspacePath: '/fixture',
});

describe('generated pagination cursor round trips', () => {
    it.each(['a'.repeat(2048), '会'.repeat(1024), '🙂'.repeat(1024), '\u0001'.repeat(2048)])(
        'should continue after a maximum-size supported identifier (%#)',
        (id) => {
            const entries = [item(id, 100), item('last', 0)];
            const first = paginateConversations(entries, null, 1);
            expect(decodeConversationCursor(first.meta.nextCursor)?.id).toBe(id);
            expect(paginateConversations(entries, first.meta.nextCursor, 1).data.map((entry) => entry.id)).toEqual([
                'last',
            ]);
        },
    );

    it('should normalize out-of-range timestamps before both sorting and encoding', () => {
        const entries = [item('a', Number.MAX_VALUE), item('z', 0)];
        const first = paginateConversations(entries, null, 1);
        expect(decodeConversationCursor(first.meta.nextCursor)).toEqual({ id: 'a', source: 'codex', updatedAtMs: 0 });
        expect(paginateConversations(entries, first.meta.nextCursor, 1).data.map(({ id }) => id)).toEqual(['z']);
    });

    it('should retain a finite input bound and reject IDs above the API limit', () => {
        const encode = (id: string) => Buffer.from(JSON.stringify([1, 0, 'codex', id])).toString('base64url');
        expect(() => decodeConversationCursor(encode('a'.repeat(2049)))).toThrow(/cursor/u);
        expect(() => decodeConversationCursor('a'.repeat(18001))).toThrow(/cursor/u);
    });
});
