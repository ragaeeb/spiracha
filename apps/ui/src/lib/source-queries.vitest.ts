import { afterEach, describe, expect, it, vi } from 'vitest';

const serverFns = vi.hoisted(() => ({
    getAntigravityConversationDetailFn: vi.fn(async () => 'antigravity-detail'),
    getAntigravityDecryptionStateFn: vi.fn(async () => 'antigravity-decryption'),
    getClaudeCodeSessionDetailFn: vi.fn(async () => 'claude-detail'),
    getClaudeCodeSessionTranscriptFn: vi.fn(async () => 'claude-transcript'),
    getCursorThreadDetailFn: vi.fn(async () => 'cursor-detail'),
    getGrokSessionDetailFn: vi.fn(async () => 'grok-detail'),
    getKiroSessionDetailFn: vi.fn(async () => 'kiro-detail'),
    getOpenCodeSessionDetailFn: vi.fn(async () => 'opencode-detail'),
    getQoderSessionDetailFn: vi.fn(async () => 'qoder-detail'),
    listAntigravityConversationsFn: vi.fn(async () => 'antigravity-conversations'),
    listAntigravityWorkspacesFn: vi.fn(async () => 'antigravity-workspaces'),
    listClaudeCodeSessionsFn: vi.fn(async () => 'claude-sessions'),
    listClaudeCodeWorkspacesFn: vi.fn(async () => 'claude-workspaces'),
    listCursorThreadsFn: vi.fn(async () => 'cursor-threads'),
    listCursorWorkspacesFn: vi.fn(async () => 'cursor-workspaces'),
    listGrokSessionsFn: vi.fn(async () => 'grok-sessions'),
    listGrokWorkspacesFn: vi.fn(async () => 'grok-workspaces'),
    listKiroSessionsFn: vi.fn(async () => 'kiro-sessions'),
    listKiroWorkspacesFn: vi.fn(async () => 'kiro-workspaces'),
    listOpenCodeSessionsFn: vi.fn(async () => 'opencode-sessions'),
    listOpenCodeWorkspacesFn: vi.fn(async () => 'opencode-workspaces'),
    listQoderSessionsFn: vi.fn(async () => 'qoder-sessions'),
    listQoderWorkspacesFn: vi.fn(async () => 'qoder-workspaces'),
}));

vi.mock('@spiracha/lib/sqlite-error', () => ({
    isRetryableSqliteError: (error: unknown) => error === 'retryable',
}));
vi.mock('./antigravity-server', () => ({
    getAntigravityConversationDetailFn: serverFns.getAntigravityConversationDetailFn,
    getAntigravityDecryptionStateFn: serverFns.getAntigravityDecryptionStateFn,
    listAntigravityConversationsFn: serverFns.listAntigravityConversationsFn,
    listAntigravityWorkspacesFn: serverFns.listAntigravityWorkspacesFn,
}));
vi.mock('./claude-code-server', () => ({
    getClaudeCodeSessionDetailFn: serverFns.getClaudeCodeSessionDetailFn,
    getClaudeCodeSessionTranscriptFn: serverFns.getClaudeCodeSessionTranscriptFn,
    listClaudeCodeSessionsFn: serverFns.listClaudeCodeSessionsFn,
    listClaudeCodeWorkspacesFn: serverFns.listClaudeCodeWorkspacesFn,
}));
vi.mock('./cursor-server', () => ({
    getCursorThreadDetailFn: serverFns.getCursorThreadDetailFn,
    listCursorThreadsFn: serverFns.listCursorThreadsFn,
    listCursorWorkspacesFn: serverFns.listCursorWorkspacesFn,
}));
vi.mock('./grok-server', () => ({
    getGrokSessionDetailFn: serverFns.getGrokSessionDetailFn,
    listGrokSessionsFn: serverFns.listGrokSessionsFn,
    listGrokWorkspacesFn: serverFns.listGrokWorkspacesFn,
}));
vi.mock('./kiro-server', () => ({
    getKiroSessionDetailFn: serverFns.getKiroSessionDetailFn,
    listKiroSessionsFn: serverFns.listKiroSessionsFn,
    listKiroWorkspacesFn: serverFns.listKiroWorkspacesFn,
}));
vi.mock('./opencode-server', () => ({
    getOpenCodeSessionDetailFn: serverFns.getOpenCodeSessionDetailFn,
    listOpenCodeSessionsFn: serverFns.listOpenCodeSessionsFn,
    listOpenCodeWorkspacesFn: serverFns.listOpenCodeWorkspacesFn,
}));
vi.mock('./qoder-server', () => ({
    getQoderSessionDetailFn: serverFns.getQoderSessionDetailFn,
    listQoderSessionsFn: serverFns.listQoderSessionsFn,
    listQoderWorkspacesFn: serverFns.listQoderWorkspacesFn,
}));

import {
    antigravityConversationDetailQueryOptions,
    antigravityConversationsQueryOptions,
    antigravityDecryptionQueryOptions,
    antigravityWorkspacesQueryOptions,
} from './antigravity-queries';
import {
    claudeCodeSessionDetailQueryOptions,
    claudeCodeSessionsQueryOptions,
    claudeCodeSessionTranscriptQueryOptions,
    claudeCodeWorkspacesQueryOptions,
} from './claude-code-queries';
import {
    cursorThreadDetailQueryOptions,
    cursorThreadsQueryOptions,
    cursorWorkspacesQueryOptions,
} from './cursor-queries';
import { grokSessionDetailQueryOptions, grokSessionsQueryOptions, grokWorkspacesQueryOptions } from './grok-queries';
import { kiroSessionDetailQueryOptions, kiroSessionsQueryOptions, kiroWorkspacesQueryOptions } from './kiro-queries';
import {
    openCodeSessionDetailQueryOptions,
    openCodeSessionsQueryOptions,
    openCodeWorkspacesQueryOptions,
} from './opencode-queries';
import {
    qoderSessionDetailQueryOptions,
    qoderSessionsQueryOptions,
    qoderWorkspacesQueryOptions,
} from './qoder-queries';

type RunnableQuery = {
    queryFn?: unknown;
};

const runQuery = async (options: RunnableQuery) => {
    return await (options.queryFn as () => Promise<unknown>)();
};

const expectDisabledQuery = async (options: RunnableQuery & { enabled?: unknown; queryKey: readonly unknown[] }) => {
    expect(options.enabled).toBe(false);
    expect(options.queryKey.at(-1)).toBe('none');
    await runQuery(options);
};

afterEach(() => {
    vi.clearAllMocks();
});

describe('source query options', () => {
    it('should configure Antigravity workspace, decryption, conversation, and detail queries', async () => {
        expect(await runQuery(antigravityDecryptionQueryOptions())).toBe('antigravity-decryption');
        expect(await runQuery(antigravityWorkspacesQueryOptions())).toBe('antigravity-workspaces');
        expect(await runQuery(antigravityConversationsQueryOptions('workspace-a'))).toBe('antigravity-conversations');
        expect(await runQuery(antigravityConversationDetailQueryOptions('conversation-a'))).toBe('antigravity-detail');
        await expectDisabledQuery(antigravityConversationsQueryOptions(null));
        await expectDisabledQuery(antigravityConversationDetailQueryOptions(null));

        expect(serverFns.listAntigravityConversationsFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getAntigravityConversationDetailFn).toHaveBeenLastCalledWith({
            data: { conversationId: '' },
        });
    });

    it('should configure Claude Code workspace, session, detail, and transcript queries', async () => {
        expect(await runQuery(claudeCodeWorkspacesQueryOptions())).toBe('claude-workspaces');
        expect(await runQuery(claudeCodeSessionsQueryOptions('workspace-a'))).toBe('claude-sessions');
        expect(await runQuery(claudeCodeSessionDetailQueryOptions('session-a'))).toBe('claude-detail');
        expect(await runQuery(claudeCodeSessionTranscriptQueryOptions('session-a'))).toBe('claude-transcript');
        await expectDisabledQuery(claudeCodeSessionsQueryOptions(null));
        await expectDisabledQuery(claudeCodeSessionDetailQueryOptions(null));
        await expectDisabledQuery(claudeCodeSessionTranscriptQueryOptions(null));

        expect(serverFns.listClaudeCodeSessionsFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getClaudeCodeSessionDetailFn).toHaveBeenLastCalledWith({ data: { sessionId: '' } });
        expect(serverFns.getClaudeCodeSessionTranscriptFn).toHaveBeenLastCalledWith({ data: { sessionId: '' } });
    });

    it('should configure Cursor queries with bounded SQLite retries', async () => {
        const options = cursorWorkspacesQueryOptions();
        expect(await runQuery(options)).toBe('cursor-workspaces');
        expect((options.retry as (failures: number, error: unknown) => boolean)(2, 'retryable')).toBe(true);
        expect((options.retry as (failures: number, error: unknown) => boolean)(3, 'retryable')).toBe(false);
        expect((options.retryDelay as (attempt: number) => number)(0)).toBe(150);
        expect((options.retryDelay as (attempt: number) => number)(1)).toBe(400);
        expect((options.retryDelay as (attempt: number) => number)(2)).toBe(800);
        expect(await runQuery(cursorThreadsQueryOptions('workspace-a'))).toBe('cursor-threads');
        expect(await runQuery(cursorThreadDetailQueryOptions('thread-a'))).toBe('cursor-detail');
        await expectDisabledQuery(cursorThreadsQueryOptions(null));
        await expectDisabledQuery(cursorThreadDetailQueryOptions(null));

        expect(serverFns.listCursorThreadsFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getCursorThreadDetailFn).toHaveBeenLastCalledWith({ data: { composerId: '' } });
    });

    it('should configure Grok, Kiro, and Qoder workspace, session, and detail queries', async () => {
        const sources = [
            {
                detail: grokSessionDetailQueryOptions,
                detailResult: 'grok-detail',
                sessions: grokSessionsQueryOptions,
                sessionsResult: 'grok-sessions',
                workspaces: grokWorkspacesQueryOptions,
                workspacesResult: 'grok-workspaces',
            },
            {
                detail: kiroSessionDetailQueryOptions,
                detailResult: 'kiro-detail',
                sessions: kiroSessionsQueryOptions,
                sessionsResult: 'kiro-sessions',
                workspaces: kiroWorkspacesQueryOptions,
                workspacesResult: 'kiro-workspaces',
            },
            {
                detail: qoderSessionDetailQueryOptions,
                detailResult: 'qoder-detail',
                sessions: qoderSessionsQueryOptions,
                sessionsResult: 'qoder-sessions',
                workspaces: qoderWorkspacesQueryOptions,
                workspacesResult: 'qoder-workspaces',
            },
        ];

        for (const source of sources) {
            expect(await runQuery(source.workspaces())).toBe(source.workspacesResult);
            expect(await runQuery(source.sessions('workspace-a'))).toBe(source.sessionsResult);
            expect(await runQuery(source.detail('session-a'))).toBe(source.detailResult);
            await expectDisabledQuery(source.sessions(null));
            await expectDisabledQuery(source.detail(null));
        }
    });

    it('should configure OpenCode queries with bounded SQLite retries', async () => {
        const options = openCodeWorkspacesQueryOptions();
        expect(await runQuery(options)).toBe('opencode-workspaces');
        expect((options.retry as (failures: number, error: unknown) => boolean)(2, 'retryable')).toBe(true);
        expect((options.retry as (failures: number, error: unknown) => boolean)(3, 'retryable')).toBe(false);
        expect((options.retryDelay as (attempt: number) => number)(0)).toBe(150);
        expect((options.retryDelay as (attempt: number) => number)(1)).toBe(400);
        expect((options.retryDelay as (attempt: number) => number)(2)).toBe(800);
        expect(await runQuery(openCodeSessionsQueryOptions('workspace-a'))).toBe('opencode-sessions');
        expect(await runQuery(openCodeSessionDetailQueryOptions('session-a'))).toBe('opencode-detail');
        await expectDisabledQuery(openCodeSessionsQueryOptions(null));
        await expectDisabledQuery(openCodeSessionDetailQueryOptions(null));

        expect(serverFns.listOpenCodeSessionsFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getOpenCodeSessionDetailFn).toHaveBeenLastCalledWith({ data: { sessionId: '' } });
    });
});
