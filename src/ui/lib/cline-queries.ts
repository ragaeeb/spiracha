import { queryOptions } from '@tanstack/react-query';
import { getClineTaskDetailFn, listClineTasksFn, listClineWorkspacesFn } from './cline-server';

export const clineWorkspacesQueryOptions = () =>
    queryOptions({ queryFn: () => listClineWorkspacesFn(), queryKey: ['cline-workspaces'] });

export const clineTasksQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listClineTasksFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['cline-tasks', workspaceKey ?? 'none'],
    });

export const clineTaskDetailQueryOptions = (taskId: string | null) =>
    queryOptions({
        enabled: taskId !== null,
        gcTime: 60_000,
        queryFn: () => getClineTaskDetailFn({ data: { taskId: taskId ?? '' } }),
        queryKey: ['cline-task', taskId ?? 'none'],
    });
