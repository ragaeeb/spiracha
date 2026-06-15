import { queryOptions } from '@tanstack/react-query';
import {
    getClaudeCodeSessionDetailFn,
    listClaudeCodeSessionsFn,
    listClaudeCodeWorkspacesFn,
} from './claude-code-server';

export const claudeCodeWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listClaudeCodeWorkspacesFn(),
        queryKey: ['claude-code-workspaces'],
    });

export const claudeCodeSessionsQueryOptions = (workspaceKey: string | null) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listClaudeCodeSessionsFn({ data: { workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['claude-code-sessions', workspaceKey ?? 'none'],
    });

export const claudeCodeSessionDetailQueryOptions = (sessionId: string | null) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getClaudeCodeSessionDetailFn({ data: { sessionId: sessionId ?? '' } }),
        queryKey: ['claude-code-session', sessionId ?? 'none'],
    });
