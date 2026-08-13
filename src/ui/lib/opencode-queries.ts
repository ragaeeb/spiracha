import { isRetryableSqliteError } from '@spiracha/lib/sqlite-error';
import { queryOptions } from '@tanstack/react-query';
import { getOpenCodeSessionDetailFn, listOpenCodeSessionsFn, listOpenCodeWorkspacesFn } from './opencode-server';

const retrySqliteQuery = (failureCount: number, error: unknown) => {
    return failureCount < 3 && isRetryableSqliteError(error);
};

const retryDelay = (attemptIndex: number) => {
    return [150, 400][attemptIndex] ?? 800;
};

export const openCodeWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listOpenCodeWorkspacesFn(),
        queryKey: ['opencode-workspaces'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const openCodeSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listOpenCodeSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['opencode-sessions', workspaceKey ?? 'none'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const openCodeSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getOpenCodeSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['opencode-session', sessionId ?? 'none'],
        retry: retrySqliteQuery,
        retryDelay,
    });
