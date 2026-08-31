import { afterEach, describe, expect, it, vi } from 'vitest';

const serverFns = vi.hoisted(() => ({
    getAntigravityConversationDetailFn: vi.fn(async () => 'antigravity-detail'),
    getAntigravityConversationDocumentsFn: vi.fn(async () => 'antigravity-documents'),
    getAntigravityDecryptionStateFn: vi.fn(async () => 'antigravity-decryption'),
    getClaudeCodeSessionDetailFn: vi.fn(async () => 'claude-detail'),
    getClaudeCodeSessionTranscriptFn: vi.fn(async () => 'claude-transcript'),
    getClineTaskDetailFn: vi.fn(async () => 'cline-detail'),
    getCursorThreadDetailFn: vi.fn(async () => 'cursor-detail'),
    getCursorThreadTranscriptFn: vi.fn(async () => 'cursor-transcript'),
    getFxSessionDetailFn: vi.fn(async () => 'fx-detail'),
    getGrokSessionDetailFn: vi.fn(async () => 'grok-detail'),
    getKiroSessionDetailFn: vi.fn(async () => 'kiro-detail'),
    getMiniMaxCodeSessionDetailFn: vi.fn(async () => 'minimax-code-detail'),
    getOpenCodeSessionDetailFn: vi.fn(async () => 'opencode-detail'),
    getQoderSessionDetailFn: vi.fn(async () => 'qoder-detail'),
    listAntigravityConversationsFn: vi.fn(async () => 'antigravity-conversations'),
    listAntigravityWorkspacesFn: vi.fn(async () => 'antigravity-workspaces'),
    listClaudeCodeSessionsFn: vi.fn(async () => 'claude-sessions'),
    listClaudeCodeWorkspacesFn: vi.fn(async () => 'claude-workspaces'),
    listClineTasksFn: vi.fn(async () => 'cline-tasks'),
    listClineWorkspacesFn: vi.fn(async () => 'cline-workspaces'),
    listCursorThreadsFn: vi.fn(async () => 'cursor-threads'),
    listCursorWorkspacesFn: vi.fn(async () => 'cursor-workspaces'),
    listFxSessionsFn: vi.fn(async () => 'fx-sessions'),
    listFxWorkspacesFn: vi.fn(async () => 'fx-workspaces'),
    listGrokSessionsFn: vi.fn(async () => 'grok-sessions'),
    listGrokWorkspacesFn: vi.fn(async () => 'grok-workspaces'),
    listKiroSessionsFn: vi.fn(async () => 'kiro-sessions'),
    listKiroWorkspacesFn: vi.fn(async () => 'kiro-workspaces'),
    listMiniMaxCodeSessionsFn: vi.fn(async () => 'minimax-code-sessions'),
    listMiniMaxCodeWorkspacesFn: vi.fn(async () => 'minimax-code-workspaces'),
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
    getAntigravityConversationDocumentsFn: serverFns.getAntigravityConversationDocumentsFn,
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
    getCursorThreadTranscriptFn: serverFns.getCursorThreadTranscriptFn,
    listCursorThreadsFn: serverFns.listCursorThreadsFn,
    listCursorWorkspacesFn: serverFns.listCursorWorkspacesFn,
}));
vi.mock('./cline-server', () => ({
    getClineTaskDetailFn: serverFns.getClineTaskDetailFn,
    listClineTasksFn: serverFns.listClineTasksFn,
    listClineWorkspacesFn: serverFns.listClineWorkspacesFn,
}));
vi.mock('./grok-server', () => ({
    getGrokSessionDetailFn: serverFns.getGrokSessionDetailFn,
    listGrokSessionsFn: serverFns.listGrokSessionsFn,
    listGrokWorkspacesFn: serverFns.listGrokWorkspacesFn,
}));
vi.mock('./fx-server', () => ({
    getFxSessionDetailFn: serverFns.getFxSessionDetailFn,
    listFxSessionsFn: serverFns.listFxSessionsFn,
    listFxWorkspacesFn: serverFns.listFxWorkspacesFn,
}));
vi.mock('./kiro-server', () => ({
    getKiroSessionDetailFn: serverFns.getKiroSessionDetailFn,
    listKiroSessionsFn: serverFns.listKiroSessionsFn,
    listKiroWorkspacesFn: serverFns.listKiroWorkspacesFn,
}));
vi.mock('./minimax-code-server', () => ({
    getMiniMaxCodeSessionDetailFn: serverFns.getMiniMaxCodeSessionDetailFn,
    listMiniMaxCodeSessionsFn: serverFns.listMiniMaxCodeSessionsFn,
    listMiniMaxCodeWorkspacesFn: serverFns.listMiniMaxCodeWorkspacesFn,
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
    antigravityConversationDocumentsQueryOptions,
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
import { clineTaskDetailQueryOptions, clineTasksQueryOptions, clineWorkspacesQueryOptions } from './cline-queries';
import {
    cursorThreadDetailQueryOptions,
    cursorThreadsQueryOptions,
    cursorThreadTranscriptQueryOptions,
    cursorWorkspacesQueryOptions,
} from './cursor-queries';
import { fxSessionDetailQueryOptions, fxSessionsQueryOptions, fxWorkspacesQueryOptions } from './fx-queries';
import { grokSessionDetailQueryOptions, grokSessionsQueryOptions, grokWorkspacesQueryOptions } from './grok-queries';
import { kiroSessionDetailQueryOptions, kiroSessionsQueryOptions, kiroWorkspacesQueryOptions } from './kiro-queries';
import {
    miniMaxCodeSessionDetailQueryOptions,
    miniMaxCodeSessionsQueryOptions,
    miniMaxCodeWorkspacesQueryOptions,
} from './minimax-code-queries';
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
    expect(options.queryKey).toContain('none');
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
        expect(await runQuery(antigravityConversationDocumentsQueryOptions('conversation-a'))).toBe(
            'antigravity-documents',
        );
        await expectDisabledQuery(antigravityConversationsQueryOptions(null));
        await expectDisabledQuery(antigravityConversationDetailQueryOptions(null));
        await expectDisabledQuery(antigravityConversationDocumentsQueryOptions(null));

        expect(serverFns.listAntigravityConversationsFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getAntigravityConversationDetailFn).toHaveBeenLastCalledWith({
            data: { conversationId: '' },
        });
        expect(serverFns.getAntigravityConversationDocumentsFn).toHaveBeenLastCalledWith({
            data: { conversationId: '' },
        });
    });

    it('should bound inactive heavy detail query retention without shortening list caches', () => {
        const heavyQueries = [
            antigravityConversationDetailQueryOptions('conversation-a'),
            antigravityConversationDocumentsQueryOptions('conversation-a'),
            claudeCodeSessionDetailQueryOptions('session-a'),
            claudeCodeSessionTranscriptQueryOptions('session-a'),
            clineTaskDetailQueryOptions('task-a'),
            cursorThreadDetailQueryOptions('thread-a'),
            cursorThreadTranscriptQueryOptions('thread-a'),
            fxSessionDetailQueryOptions('session-a'),
            grokSessionDetailQueryOptions('session-a'),
            kiroSessionDetailQueryOptions('session-a'),
            miniMaxCodeSessionDetailQueryOptions('session-a'),
            openCodeSessionDetailQueryOptions('session-a'),
            qoderSessionDetailQueryOptions('session-a'),
        ];

        for (const query of heavyQueries) {
            expect(query.gcTime).toBe(60_000);
        }

        expect(antigravityConversationsQueryOptions('workspace-a').gcTime).toBeUndefined();
        expect(claudeCodeSessionsQueryOptions('workspace-a').gcTime).toBe(15 * 60_000);
        expect(cursorThreadsQueryOptions('workspace-a').gcTime).toBeUndefined();
    });

    it('should configure Claude Code workspace, session, detail, and transcript queries', async () => {
        expect(claudeCodeSessionsQueryOptions('workspace-a')).toMatchObject({
            gcTime: 15 * 60_000,
            staleTime: 5_000,
        });
        expect(await runQuery(claudeCodeWorkspacesQueryOptions())).toBe('claude-workspaces');
        expect(await runQuery(claudeCodeSessionsQueryOptions('workspace-a'))).toBe('claude-sessions');
        expect(await runQuery(claudeCodeSessionDetailQueryOptions('session-a'))).toBe('claude-detail');
        expect(await runQuery(claudeCodeSessionTranscriptQueryOptions('session-a'))).toBe('claude-transcript');
        await expectDisabledQuery(claudeCodeSessionsQueryOptions(null));
        await expectDisabledQuery(claudeCodeSessionDetailQueryOptions(null));
        await expectDisabledQuery(claudeCodeSessionTranscriptQueryOptions(null));

        expect(serverFns.listClaudeCodeSessionsFn).toHaveBeenCalledWith({
            data: { workspaceKey: 'workspace-a' },
        });
        expect(serverFns.getClaudeCodeSessionDetailFn).toHaveBeenCalledWith({
            data: { sessionId: 'session-a' },
        });
        expect(serverFns.getClaudeCodeSessionTranscriptFn).toHaveBeenCalledWith({
            data: { sessionId: 'session-a' },
        });
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
        expect(await runQuery(cursorThreadTranscriptQueryOptions('thread-a'))).toBe('cursor-transcript');
        await expectDisabledQuery(cursorThreadsQueryOptions(null));
        await expectDisabledQuery(cursorThreadDetailQueryOptions(null));
        await expectDisabledQuery(cursorThreadTranscriptQueryOptions(null));

        expect(serverFns.listCursorThreadsFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getCursorThreadDetailFn).toHaveBeenLastCalledWith({ data: { composerId: '' } });
        expect(serverFns.getCursorThreadTranscriptFn).toHaveBeenLastCalledWith({ data: { composerId: '' } });
    });

    it('should configure Cline workspace, chat, and detail queries', async () => {
        expect(await runQuery(clineWorkspacesQueryOptions())).toBe('cline-workspaces');
        expect(await runQuery(clineTasksQueryOptions('workspace-a'))).toBe('cline-tasks');
        expect(await runQuery(clineTaskDetailQueryOptions('1'))).toBe('cline-detail');
        await expectDisabledQuery(clineTasksQueryOptions(null));
        await expectDisabledQuery(clineTaskDetailQueryOptions(null));
        expect(serverFns.listClineTasksFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getClineTaskDetailFn).toHaveBeenLastCalledWith({ data: { taskId: '' } });
    });

    it('should configure Grok, Kiro, and Qoder workspace, session, and detail queries', async () => {
        expect(kiroSessionsQueryOptions('workspace-a')).toMatchObject({
            gcTime: 15 * 60_000,
            staleTime: 5_000,
        });
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
        expect(openCodeSessionsQueryOptions('workspace-a')).toMatchObject({
            gcTime: 15 * 60_000,
            staleTime: 5_000,
        });
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

    it('should configure FX workspace, session, and detail queries', async () => {
        expect(await runQuery(fxWorkspacesQueryOptions())).toBe('fx-workspaces');
        expect(await runQuery(fxSessionsQueryOptions('workspace-a'))).toBe('fx-sessions');
        expect(await runQuery(fxSessionDetailQueryOptions('session-a'))).toBe('fx-detail');
        await expectDisabledQuery(fxSessionsQueryOptions(null));
        await expectDisabledQuery(fxSessionDetailQueryOptions(null));

        expect(serverFns.listFxSessionsFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getFxSessionDetailFn).toHaveBeenLastCalledWith({ data: { sessionId: '' } });
    });

    it('should configure MiniMax Code workspace, session, and detail queries', async () => {
        expect(await runQuery(miniMaxCodeWorkspacesQueryOptions())).toBe('minimax-code-workspaces');
        expect(await runQuery(miniMaxCodeSessionsQueryOptions('workspace-a'))).toBe('minimax-code-sessions');
        expect(await runQuery(miniMaxCodeSessionDetailQueryOptions('session-a'))).toBe('minimax-code-detail');
        await expectDisabledQuery(miniMaxCodeSessionsQueryOptions(null));
        await expectDisabledQuery(miniMaxCodeSessionDetailQueryOptions(null));

        expect(serverFns.listMiniMaxCodeSessionsFn).toHaveBeenLastCalledWith({ data: { workspaceKey: '' } });
        expect(serverFns.getMiniMaxCodeSessionDetailFn).toHaveBeenLastCalledWith({ data: { sessionId: '' } });
    });
});
