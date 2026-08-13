import { queryOptions } from '@tanstack/react-query';
import { getGrokSessionDetailFn, listGrokSessionsFn, listGrokWorkspacesFn } from './grok-server';

export const grokWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listGrokWorkspacesFn(),
        queryKey: ['grok-workspaces'],
    });

export const grokSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listGrokSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['grok-sessions', workspaceKey ?? 'none'],
    });

export const grokSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getGrokSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['grok-session', sessionId ?? 'none'],
    });
