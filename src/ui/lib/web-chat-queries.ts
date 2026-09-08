import { queryOptions } from '@tanstack/react-query';
import { getWebChatArtifactsFn, getWebChatEventsFn, getWebChatFn, listWebChatsFn } from './web-chat-server';

export const webChatArtifactsQueryOptions = (conversationId: string) =>
    queryOptions({
        gcTime: 60_000,
        queryFn: () => getWebChatArtifactsFn({ data: { conversationId } }),
        queryKey: ['web-chat-artifacts', conversationId],
    });

export const webChatsQueryOptions = () =>
    queryOptions({
        queryFn: () => listWebChatsFn(),
        queryKey: ['web-chats'],
    });

export const webChatQueryOptions = (conversationId: string | null) =>
    queryOptions({
        enabled: conversationId !== null,
        gcTime: 60_000,
        queryFn: () => getWebChatFn({ data: { conversationId: conversationId ?? '' } }),
        queryKey: ['web-chat', conversationId ?? 'none'],
    });

export const webChatEventsQueryOptions = (conversationId: string | null) =>
    queryOptions({
        enabled: conversationId !== null,
        gcTime: 60_000,
        queryFn: () => getWebChatEventsFn({ data: { conversationId: conversationId ?? '' } }),
        queryKey: ['web-chat-events', conversationId ?? 'none'],
    });
