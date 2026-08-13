import { isRetryableSqliteError } from '@spiracha/lib/sqlite-error';
import { queryOptions } from '@tanstack/react-query';
import { getQoderSessionDetailFn, listQoderSessionsFn, listQoderWorkspacesFn } from './qoder-server';

const retrySqliteQuery = (failureCount: number, error: unknown) => {
    return failureCount < 3 && isRetryableSqliteError(error);
};

const retryDelay = (attemptIndex: number) => {
    return [150, 400][attemptIndex] ?? 800;
};

export const qoderWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listQoderWorkspacesFn(),
        queryKey: ['qoder-workspaces'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const qoderSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listQoderSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['qoder-sessions', workspaceKey ?? 'none'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const qoderSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getQoderSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['qoder-session', sessionId ?? 'none'],
        retry: retrySqliteQuery,
        retryDelay,
    });
