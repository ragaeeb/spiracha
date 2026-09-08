import { queryOptions } from '@tanstack/react-query';
import { getCodexCloudTaskFn, listCodexCloudProjectFn, listCodexCloudProjectsFn } from './codex-cloud-server';

const cloudQueryDefaults = {
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
} as const;

export const codexCloudProjectsQueryOptions = () =>
    queryOptions({
        ...cloudQueryDefaults,
        queryFn: () => listCodexCloudProjectsFn(),
        queryKey: ['codex-cloud-projects'],
    });

export const codexCloudProjectQueryOptions = (projectId: string) =>
    queryOptions({
        ...cloudQueryDefaults,
        queryFn: () => listCodexCloudProjectFn({ data: { projectId } }),
        queryKey: ['codex-cloud-project', projectId],
    });

export const codexCloudTaskQueryOptions = (taskId: string) =>
    queryOptions({
        ...cloudQueryDefaults,
        gcTime: 60_000,
        queryFn: () => getCodexCloudTaskFn({ data: { taskId } }),
        queryKey: ['codex-cloud-task', taskId],
    });
