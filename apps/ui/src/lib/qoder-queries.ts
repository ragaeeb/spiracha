import { queryOptions } from '@tanstack/react-query';
import { getQoderSessionDetailFn, listQoderSessionsFn, listQoderWorkspacesFn } from './qoder-server';

export const qoderWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listQoderWorkspacesFn(),
        queryKey: ['qoder-workspaces'],
    });

export const qoderSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listQoderSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['qoder-sessions', workspaceKey ?? 'none'],
    });

export const qoderSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getQoderSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['qoder-session', sessionId ?? 'none'],
    });
