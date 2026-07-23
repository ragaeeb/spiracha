import { queryOptions } from '@tanstack/react-query';
import { getKiroSessionDetailFn, listKiroSessionsFn, listKiroWorkspacesFn } from './kiro-server';

export const kiroWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listKiroWorkspacesFn(),
        queryKey: ['kiro-workspaces'],
    });

export const kiroSessionsQueryOptions = (workspaceKey: string | null, merged = false) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listKiroSessionsFn({ data: { merged, workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['kiro-sessions', workspaceKey ?? 'none', { merged }],
    });

export const kiroSessionDetailQueryOptions = (sessionId: string | null, merged = false) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getKiroSessionDetailFn({ data: { merged, sessionId: sessionId ?? '' } }),
        queryKey: ['kiro-session', sessionId ?? 'none', { merged }],
    });
