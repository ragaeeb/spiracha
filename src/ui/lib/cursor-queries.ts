import { isRetryableSqliteError } from '@spiracha/lib/sqlite-error';
import { queryOptions } from '@tanstack/react-query';
import { getCursorThreadDetailFn, listCursorThreadsFn, listCursorWorkspacesFn } from './cursor-server';

const retrySqliteQuery = (failureCount: number, error: unknown) => {
    return failureCount < 3 && isRetryableSqliteError(error);
};

const retryDelay = (attemptIndex: number) => {
    return [150, 400][attemptIndex] ?? 800;
};

export const cursorWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listCursorWorkspacesFn(),
        queryKey: ['cursor-workspaces'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const cursorThreadsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listCursorThreadsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['cursor-threads', workspaceKey ?? 'none'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const cursorThreadDetailQueryOptions = (composerId: string | null) =>
    queryOptions({
        enabled: composerId !== null,
        queryFn: () => getCursorThreadDetailFn({ data: { composerId: composerId ?? '' } }),
        queryKey: ['cursor-thread', composerId ?? 'none'],
        retry: retrySqliteQuery,
        retryDelay,
    });
