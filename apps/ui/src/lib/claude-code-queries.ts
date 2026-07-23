import { queryOptions } from '@tanstack/react-query';
import {
    getClaudeCodeSessionDetailFn,
    getClaudeCodeSessionTranscriptFn,
    listClaudeCodeSessionsFn,
    listClaudeCodeWorkspacesFn,
} from './claude-code-server';

export const claudeCodeWorkspacesQueryOptions = () =>
    queryOptions({
        queryFn: () => listClaudeCodeWorkspacesFn(),
        queryKey: ['claude-code-workspaces'],
    });

export const claudeCodeSessionsQueryOptions = (workspaceKey: string | null, merged = false) =>
    queryOptions({
        enabled: workspaceKey !== null,
        queryFn: () => listClaudeCodeSessionsFn({ data: { merged, workspaceKey: workspaceKey ?? '' } }),
        queryKey: ['claude-code-sessions', workspaceKey ?? 'none', { merged }],
    });

export const claudeCodeSessionDetailQueryOptions = (sessionId: string | null, merged = false) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getClaudeCodeSessionDetailFn({ data: { merged, sessionId: sessionId ?? '' } }),
        queryKey: ['claude-code-session', sessionId ?? 'none', { merged }],
    });

export const claudeCodeSessionTranscriptQueryOptions = (sessionId: string | null, merged = false) =>
    queryOptions({
        enabled: sessionId !== null,
        queryFn: () => getClaudeCodeSessionTranscriptFn({ data: { merged, sessionId: sessionId ?? '' } }),
        queryKey: ['claude-code-session-transcript', sessionId ?? 'none', { merged }],
    });
