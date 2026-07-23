import { queryOptions } from '@tanstack/react-query';
import {
    getMiniMaxCodeSessionDetailFn,
    listMiniMaxCodeSessionsFn,
    listMiniMaxCodeWorkspacesFn,
} from './minimax-code-server';

export const miniMaxCodeWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listMiniMaxCodeWorkspacesFn(),
        queryKey: ['minimax-code-workspaces'],
    });

export const miniMaxCodeSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listMiniMaxCodeSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['minimax-code-sessions', workspaceKey ?? 'none'],
    });

export const miniMaxCodeSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getMiniMaxCodeSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['minimax-code-session', sessionId ?? 'none'],
    });
