import { queryOptions } from '@tanstack/react-query';
import { getGrokBotChatFn, listGrokBotChatsFn } from './grok-bot-server';

export const grokBotChatsQueryOptions = () =>
    queryOptions({
        queryFn: () => listGrokBotChatsFn(),
        queryKey: ['grok-bot-chats'],
    });

export const grokBotChatQueryOptions = (conversationId: string | null) =>
    queryOptions({
        enabled: conversationId !== null,
        gcTime: 60_000,
        queryFn: () => getGrokBotChatFn({ data: { conversationId: conversationId ?? '' } }),
        queryKey: ['grok-bot-chat', conversationId ?? 'none'],
    });
