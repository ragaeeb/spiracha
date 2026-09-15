import { describe, expect, it, spyOn } from 'bun:test';
import { isWithinUpdatedWindow } from './adapter-helpers';
import { grokBotConversationAdapter } from './grok-bot-adapter';
import { listConversations } from './index';
import type { ConversationDetail } from './types';

const entry = (id: string, updatedAtMs: number): ConversationDetail => ({
    createdAtMs: null,
    deepLinks: { native: null, spiracha: `spiracha://conversation/grok-bot/${id}`, ui: `/grok-bot-chats/${id}` },
    id,
    matches: [],
    messageCount: 0,
    messages: [],
    metadata: {},
    source: 'grok-bot',
    title: id,
    updatedAtMs,
    workspaceKey: null,
    workspacePath: null,
});

describe('fractional timestamp cursor boundaries', () => {
    it('should retain the rest of a cursor millisecond bucket on the next page', async () => {
        const entries = [entry('a', 1000.9), entry('b', 1000.8), entry('c', 999)];
        const spy = spyOn(grokBotConversationAdapter, 'listConversations').mockImplementation(async (options) =>
            entries.filter((conversation) => isWithinUpdatedWindow(conversation.updatedAtMs, options)),
        );
        try {
            const first = await listConversations({ limit: 1, sources: ['grok-bot'] });
            const second = await listConversations({ cursor: first.meta.nextCursor, limit: 1, sources: ['grok-bot'] });
            expect(first.data.map(({ id }) => id)).toEqual(['a']);
            expect(second.data.map(({ id }) => id)).toEqual(['b']);
        } finally {
            spy.mockRestore();
        }
    });
});
