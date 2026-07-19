import { isRetryableSqliteError } from '@spiracha/lib/sqlite-error';
import { queryOptions } from '@tanstack/react-query';
import {
    getAnalyticsFn,
    getDashboardSummaryFn,
    getThreadSnapshotFn,
    getThreadTranscriptFn,
    getThreadTranscriptPreviewFn,
    listProjectsFn,
    listProjectThreadsFn,
} from './codex-server';

type ThreadTranscriptFilters = {
    showCommentary: boolean;
    showExtraEvents: boolean;
    showToolCalls: boolean;
    showUserMessages: boolean;
};

const retrySqliteQuery = (failureCount: number, error: unknown) => {
    return failureCount < 3 && isRetryableSqliteError(error);
};

const retryDelay = (attemptIndex: number) => {
    return [150, 400][attemptIndex] ?? 800;
};

export const dashboardQueryOptions = () =>
    queryOptions({
        queryFn: () => getDashboardSummaryFn(),
        queryKey: ['dashboard'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const projectsQueryOptions = () =>
    queryOptions({
        queryFn: () => listProjectsFn(),
        queryKey: ['projects'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const projectThreadsQueryOptions = (project: string) =>
    queryOptions({
        queryFn: () => listProjectThreadsFn({ data: { project } }),
        queryKey: ['project-threads', project],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const threadSnapshotQueryOptions = (threadId: string) =>
    queryOptions({
        queryFn: () => getThreadSnapshotFn({ data: { threadId } }),
        queryKey: ['thread', threadId],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const threadTranscriptPreviewQueryOptions = (threadId: string, filters?: ThreadTranscriptFilters) =>
    queryOptions({
        queryFn: () => getThreadTranscriptPreviewFn({ data: { filters, threadId } }),
        queryKey: ['thread-transcript-preview', threadId, filters ?? 'all'],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const threadTranscriptQueryOptions = (threadId: string) =>
    queryOptions({
        queryFn: () => getThreadTranscriptFn({ data: { threadId } }),
        queryKey: ['thread-transcript', threadId],
        retry: retrySqliteQuery,
        retryDelay,
    });

export const analyticsQueryOptions = (project: string | null) =>
    queryOptions({
        queryFn: () => getAnalyticsFn({ data: { project } }),
        queryKey: ['analytics', project ?? 'all'],
        retry: retrySqliteQuery,
        retryDelay,
    });
