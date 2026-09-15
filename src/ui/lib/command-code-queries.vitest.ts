import { expect, it, vi } from 'vitest';

const serverFns = vi.hoisted(() => ({
    getCommandCodeSessionDetailFn: vi.fn(async () => 'command-code-detail'),
    listCommandCodeSessionsFn: vi.fn(async () => 'command-code-sessions'),
    listCommandCodeWorkspacesFn: vi.fn(async () => 'command-code-workspaces'),
}));

vi.mock('./command-code-server', () => serverFns);

import {
    commandCodeSessionDetailQueryOptions,
    commandCodeSessionsQueryOptions,
    commandCodeWorkspacesQueryOptions,
} from './command-code-queries';

const runQuery = async (options: { queryFn?: unknown }) => await (options.queryFn as () => Promise<unknown>)();

it('should configure Command Code workspace, session, and detail queries', async () => {
    expect(await runQuery(commandCodeWorkspacesQueryOptions())).toBe('command-code-workspaces');
    expect(await runQuery(commandCodeSessionsQueryOptions('workspace-a'))).toBe('command-code-sessions');
    expect(await runQuery(commandCodeSessionDetailQueryOptions('session-a'))).toBe('command-code-detail');

    expect(serverFns.listCommandCodeSessionsFn).toHaveBeenLastCalledWith({
        data: { workspaceKey: 'workspace-a' },
    });
    expect(serverFns.getCommandCodeSessionDetailFn).toHaveBeenLastCalledWith({
        data: { sessionId: 'session-a' },
    });

    const disabledSessions = commandCodeSessionsQueryOptions(null);
    const disabledDetail = commandCodeSessionDetailQueryOptions(null);
    expect(disabledSessions.enabled).toBe(false);
    expect(disabledSessions.queryKey).toContain('none');
    expect(disabledDetail.enabled).toBe(false);
    expect(disabledDetail.queryKey).toContain('none');
    await runQuery(disabledSessions);
    await runQuery(disabledDetail);
});
