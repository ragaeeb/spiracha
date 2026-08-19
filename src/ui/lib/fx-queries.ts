import { queryOptions } from '@tanstack/react-query';
import { getFxSessionDetailFn, listFxSessionsFn, listFxWorkspacesFn } from './fx-server';

export const fxWorkspacesQueryOptions = () =>
    queryOptions({ queryFn: () => listFxWorkspacesFn(), queryKey: ['fx-workspaces'] });

export const fxSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listFxSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['fx-sessions', workspaceKey ?? 'none'],
    });

export const fxSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getFxSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['fx-session', sessionId ?? 'none'],
    });
