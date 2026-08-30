import { afterEach, describe, expect, it, vi } from 'vitest';

const serverFns = vi.hoisted(() => ({
    getWebChatEventsFn: vi.fn(async () => ['event']),
    getWebChatFn: vi.fn(async () => 'conversation'),
    listWebChatsFn: vi.fn(async () => ['conversation']),
}));

vi.mock('./web-chat-server', () => serverFns);

import { webChatEventsQueryOptions, webChatQueryOptions, webChatsQueryOptions } from './web-chat-queries';

const runQuery = async (options: { queryFn?: unknown }) => (options.queryFn as () => Promise<unknown>)();

afterEach(() => vi.clearAllMocks());

describe('web chat query options', () => {
    it('should load lists, lightweight detail metadata, and deferred events', async () => {
        expect(await runQuery(webChatsQueryOptions())).toEqual(['conversation']);
        expect(await runQuery(webChatQueryOptions('chat-1'))).toBe('conversation');
        expect(await runQuery(webChatEventsQueryOptions('chat-1'))).toEqual(['event']);
        expect(serverFns.getWebChatFn).toHaveBeenCalledWith({ data: { conversationId: 'chat-1' } });
        expect(serverFns.getWebChatEventsFn).toHaveBeenCalledWith({ data: { conversationId: 'chat-1' } });
    });

    it('should disable detail queries without a conversation id', () => {
        expect(webChatQueryOptions(null)).toMatchObject({ enabled: false, queryKey: ['web-chat', 'none'] });
        expect(webChatEventsQueryOptions(null)).toMatchObject({
            enabled: false,
            queryKey: ['web-chat-events', 'none'],
        });
    });
});
