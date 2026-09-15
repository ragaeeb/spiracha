import { queryOptions } from '@tanstack/react-query';
import {
    getCommandCodeSessionDetailFn,
    listCommandCodeSessionsFn,
    listCommandCodeWorkspacesFn,
} from './command-code-server';

export const commandCodeWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listCommandCodeWorkspacesFn(),
        queryKey: ['command-code-workspaces'],
    });

export const commandCodeSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        gcTime: 15 * 60_000,
        queryFn: () => listCommandCodeSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['command-code-sessions', workspaceKey ?? 'none'],
        staleTime: 5_000,
    });

export const commandCodeSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        gcTime: 60_000,
        queryFn: () => getCommandCodeSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['command-code-session', sessionId ?? 'none'],
    });
