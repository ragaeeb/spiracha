import { queryOptions } from '@tanstack/react-query';
import { getKiroSessionDetailFn, listKiroSessionsFn, listKiroWorkspacesFn } from './kiro-server';

export const kiroWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listKiroWorkspacesFn(),
        queryKey: ['kiro-workspaces'],
    });

export const kiroSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listKiroSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['kiro-sessions', workspaceKey ?? 'none'],
    });

export const kiroSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getKiroSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['kiro-session', sessionId ?? 'none'],
    });
