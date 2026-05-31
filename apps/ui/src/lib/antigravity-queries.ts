import { queryOptions } from '@tanstack/react-query';
import {
    getAntigravityConversationDetailFn,
    getAntigravityDecryptionStateFn,
    listAntigravityConversationsFn,
    listAntigravityWorkspacesFn,
} from './antigravity-server';

export const antigravityDecryptionQueryOptions = () =>
    queryOptions({
        queryFn: () => getAntigravityDecryptionStateFn(),
        queryKey: ['antigravity-decryption'],
    });

export const antigravityWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listAntigravityWorkspacesFn(),
        queryKey: ['antigravity-workspaces'],
    });

export const antigravityConversationsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listAntigravityConversationsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['antigravity-conversations', workspaceKey ?? 'none'],
    });

export const antigravityConversationDetailQueryOptions = (conversationId: string | null) =>
    queryOptions({
        enabled: conversationId !== null,
        queryFn: () => getAntigravityConversationDetailFn({ data: { conversationId: conversationId ?? '' } }),
        queryKey: ['antigravity-conversation', conversationId ?? 'none'],
    });
