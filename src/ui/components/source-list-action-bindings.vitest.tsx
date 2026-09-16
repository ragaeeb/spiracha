import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import type { ClaudeCodeSessionSummary } from '@spiracha/lib/claude-code-exporter-types';
import type { ClineTaskSummary } from '@spiracha/lib/cline-exporter-types';
import type { ThreadListEntry } from '@spiracha/lib/codex-browser-types';
import type { CodexCloudTask } from '@spiracha/lib/codex-cloud';
import type { CommandCodeSessionSummary } from '@spiracha/lib/command-code-exporter-types';
import { CONVERSATION_SOURCES } from '@spiracha/lib/conversation-data/types';
import type { CursorThreadSummary } from '@spiracha/lib/cursor-exporter-types';
import type { FxSessionSummary } from '@spiracha/lib/fx-exporter-types';
import type { GrokSessionSummary } from '@spiracha/lib/grok-exporter-types';
import type { KiroSessionSummary } from '@spiracha/lib/kiro-exporter-types';
import type { MiniMaxCodeSessionSummary } from '@spiracha/lib/minimax-code-exporter-types';
import type { OpenCodeSessionSummary } from '@spiracha/lib/opencode-exporter-types';
import type { QoderSessionSummary } from '@spiracha/lib/qoder-exporter-types';
import type { WebChatConversationSummary } from '@spiracha/lib/web-chat';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactElement, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GrokBotChat } from '#/lib/grok-bot-server';

vi.mock('@tanstack/react-router', () => ({
    Link: ({
        children,
        className,
        params,
        to,
    }: {
        children: ReactNode;
        className?: string;
        params: Record<string, string>;
        to: string;
    }) => {
        let href = to;
        for (const [key, value] of Object.entries(params)) {
            href = href.replace(`$${key}`, value);
        }
        return (
            <a className={className} href={href}>
                {children}
            </a>
        );
    },
}));

vi.mock('#/components/ui/dropdown-menu', () => {
    type DropdownMenuState = {
        open: boolean;
        setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    };

    const DropdownMenuContext = React.createContext<DropdownMenuState | null>(null);
    const useDropdownMenuState = () => {
        const context = React.useContext(DropdownMenuContext);
        if (!context) {
            throw new Error('DropdownMenu mock requires a provider');
        }
        return context;
    };

    return {
        DropdownMenu: ({ children }: { children: ReactNode }) => {
            const [open, setOpen] = React.useState(false);
            return <DropdownMenuContext.Provider value={{ open, setOpen }}>{children}</DropdownMenuContext.Provider>;
        },
        DropdownMenuContent: ({ children }: { children: ReactNode }) =>
            useDropdownMenuState().open ? <div>{children}</div> : null,
        DropdownMenuItem: ({
            children,
            disabled,
            onClick,
        }: {
            children: ReactNode;
            disabled?: boolean;
            onClick?: () => void;
        }) => {
            const { setOpen } = useDropdownMenuState();
            return (
                <button
                    disabled={disabled}
                    type="button"
                    onClick={() => {
                        onClick?.();
                        setOpen(false);
                    }}
                >
                    {children}
                </button>
            );
        },
        DropdownMenuTrigger: ({ children }: { children: ReactNode }) => {
            const { open, setOpen } = useDropdownMenuState();
            if (!React.isValidElement(children)) {
                return null;
            }
            const child = children as React.ReactElement<{
                onClick?: MouseEventHandler<HTMLButtonElement>;
                'aria-expanded'?: boolean;
                'aria-haspopup'?: string;
            }>;
            return React.cloneElement(child, {
                'aria-expanded': open,
                'aria-haspopup': 'menu',
                onClick: (event) => {
                    child.props.onClick?.(event);
                    setOpen((current) => !current);
                },
            });
        },
    };
});

import { AntigravityConversationsTable } from './antigravity-conversations-table';
import { ClaudeCodeSessionsTable } from './claude-code-sessions-table';
import { ClineTasksTable } from './cline-tasks-table';
import { CodexCloudReadOnlyNotice, CodexCloudTasksTable } from './codex-cloud-tasks-table';
import { CommandCodeSessionsTable } from './command-code-sessions-table';
import { CursorThreadsTable } from './cursor-threads-table';
import { FxSessionsTable } from './fx-sessions-table';
import { GrokBotChatsTable } from './grok-bot-chats-table';
import { GrokSessionsTable } from './grok-sessions-table';
import { KiroSessionsTable } from './kiro-sessions-table';
import { MiniMaxCodeSessionsTable } from './minimax-code-sessions-table';
import { OpenCodeSessionsTable } from './opencode-sessions-table';
import { QoderSessionsTable } from './qoder-sessions-table';
import { ThreadsTable } from './threads-table';
import { WebConversationsTable } from './web-conversations-table';

type ListActionHandlers = {
    onDeleteIds: (ids: string[]) => void;
    onDeleteRow: () => void;
    onExportIds: (ids: string[]) => void;
    onExportRow: () => void;
};

type ListActionBinding = {
    deleteRowLabel: string | null;
    exportRowLabel: string;
    href: string;
    itemLabel: string;
    linkName?: string;
    render: (handlers: ListActionHandlers) => ReactElement;
    rowId: string;
    title: string;
};

type ListActionSurface = (typeof CONVERSATION_SOURCES)[number] | 'codex-cloud' | 'web';

const TIMESTAMP = 1_700_000_000_000;

const clineTask = (): ClineTaskSummary => ({
    assistantMessageCount: 1,
    cacheReads: null,
    cacheWrites: null,
    createdAtMs: TIMESTAMP,
    isFavorited: true,
    lastActiveAtMs: TIMESTAMP,
    messageCount: 42,
    messagesPath: '/tmp/cline/ui_messages.json',
    modelId: 'Cline model',
    reasoningCount: 0,
    renderablePartCount: 8,
    sessionDir: '/tmp/cline',
    taskId: '1785560414951',
    title: 'Cline review',
    tokensIn: null,
    tokensOut: null,
    toolCallCount: 12,
    toolResultCount: 12,
    totalCost: null,
    ulid: null,
    userMessageCount: 1,
    workspaceKey: 'cline-key',
    workspaceLabel: 'Cline workspace',
    worktree: '/workspace/cline',
});

const claudeSession = (): ClaudeCodeSessionSummary => ({
    assistantMessageCount: 1,
    attachmentCount: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    continuationSessionIds: [],
    createdAtIso: null,
    createdAtMs: TIMESTAMP,
    cwd: '/workspace/claude',
    filePath: '/tmp/claude.jsonl',
    gitBranch: null,
    hierarchy: { parentSessionId: null },
    inputTokens: 0,
    lastActiveAtIso: null,
    lastActiveAtMs: TIMESTAMP,
    messageCount: 1234,
    model: 'Claude model',
    outputTokens: 0,
    renderablePartCount: 1,
    sessionId: 'claude-session',
    title: 'Claude review',
    toolCallCount: 12,
    toolResultCount: 12,
    totalTokens: 2500,
    userMessageCount: 1,
    version: '1.0.0',
    workspaceKey: 'claude-key',
    workspaceLabel: 'Claude workspace',
    worktree: '/workspace/claude',
});

const commandCodeSession = (): CommandCodeSessionSummary => ({
    assistantMessageCount: 1,
    createdAtMs: TIMESTAMP,
    cwd: '/workspace/command-code',
    filePath: '/tmp/command-code/session.jsonl',
    lastActiveAtMs: TIMESTAMP + 100,
    messageCount: 2,
    model: 'z-ai/glm-5.3-flash',
    modelLabel: 'GLM 5.3 Flash',
    recordCount: 3,
    renderableMessageCount: 2,
    sessionId: 'command-code-session',
    title: 'Command Code review',
    toolCallCount: 1,
    toolOutputCount: 1,
    userMessageCount: 1,
    workspaceKey: 'command-code-key',
    workspaceLabel: 'Command Code workspace',
    worktree: '/workspace/command-code',
});

const grokSession = (): GrokSessionSummary => ({
    agentName: 'review-agent',
    assistantMessageCount: 1,
    chatHistoryPath: '/tmp/grok/history.json',
    chatMessageCount: 42,
    createdAtIso: null,
    createdAtMs: TIMESTAMP,
    currentModelId: 'grok-fallback',
    cwd: '/workspace/grok',
    gitBranch: null,
    gitRemotes: [],
    gitRootDir: null,
    headCommit: null,
    lastActiveAtIso: null,
    lastActiveAtMs: TIMESTAMP,
    messageCount: 42,
    modelLabel: 'Grok model',
    reasoningCount: 0,
    renderablePartCount: 1,
    sandboxProfile: null,
    sessionDir: '/tmp/grok',
    sessionId: 'grok-session',
    summaryPath: '/tmp/grok/summary.json',
    title: 'Grok review',
    toolCallCount: 12,
    toolResultCount: 12,
    updatesPath: null,
    userMessageCount: 1,
    workspaceKey: 'grok-key',
    workspaceLabel: 'Grok workspace',
    worktree: '/workspace/grok',
});

const kiroSession = (): KiroSessionSummary => ({
    assistantMessageCount: 1,
    autonomyMode: null,
    continuationSessionIds: [],
    createdAtIso: null,
    createdAtMs: TIMESTAMP,
    defaultModelTitle: null,
    filePath: '/tmp/kiro.jsonl',
    imageCount: 3,
    lastActiveAtIso: null,
    lastActiveAtMs: TIMESTAMP,
    messageCount: 42,
    promptLogCount: 4,
    renderablePartCount: 1,
    selectedModel: 'Kiro model',
    selectedProfileId: null,
    sessionId: 'kiro-session',
    sessionType: 'spec',
    title: 'Kiro review',
    userMessageCount: 1,
    workspaceDirectory: null,
    workspaceKey: 'kiro-key',
    workspaceLabel: 'Kiro workspace',
    workspacePath: null,
    worktree: '/workspace/kiro',
});

const qoderSession = (): QoderSessionSummary => ({
    agentClass: null,
    assistantMessageCount: 1,
    createdAtIso: null,
    createdAtMs: null,
    executionMode: null,
    fileOperationCount: 0,
    historyIds: ['history-a'],
    lastActiveAtIso: null,
    lastActiveAtMs: TIMESTAMP,
    messageCount: 2,
    model: 'Qwen 3.7 Max',
    query: null,
    renderablePartCount: 1,
    requestId: null,
    sessionId: 'task-a.session.execution',
    snapshotFileCount: 0,
    sourceStatePath: null,
    status: 'Completed',
    taskId: 'task-a',
    title: 'Qoder review',
    userMessageCount: 1,
    workspaceKey: 'workspace:key',
    workspaceLabel: 'project',
    workspacePath: '/workspace/qoder',
    workspaceStorageId: 'ws-a',
    worktree: '/workspace/qoder',
});

const fxSession = (): FxSessionSummary => ({
    assistantMessageCount: 1,
    conversationLanguage: null,
    createdAtMs: TIMESTAMP,
    currentModelId: 'fx-model',
    currentModelVariant: null,
    lastActiveAtMs: TIMESTAMP,
    messageCount: 4,
    reasoningCount: 0,
    renderablePartCount: 1,
    sessionDir: '/tmp/fx',
    sessionId: 'fx-session',
    status: null,
    title: 'FX review',
    toolCallCount: 2,
    toolResultCount: 2,
    totalInputTokens: null,
    totalOutputTokens: null,
    userMessageCount: 1,
    workspaceKey: 'fx-key',
    workspaceLabel: 'FX workspace',
    worktree: '/workspace/fx',
});

const miniMaxSession = (): MiniMaxCodeSessionSummary => ({
    agentName: null,
    appMode: null,
    archived: false,
    assistantMessageCount: 1,
    createdAtMs: TIMESTAMP,
    currentModelId: 'MiniMax model',
    currentModelVariant: null,
    lastActiveAtMs: TIMESTAMP,
    messageCount: 4,
    reasoningCount: 0,
    renderablePartCount: 1,
    runtime: null,
    sessionDir: '/tmp/minimax',
    sessionId: 'minimax-session',
    sessionType: null,
    snapshotPath: '/tmp/minimax/snapshot.json',
    status: null,
    title: 'MiniMax review',
    toolCallCount: 2,
    toolResultCount: 2,
    userMessageCount: 1,
    workspaceKey: 'minimax-key',
    workspaceLabel: 'MiniMax workspace',
    worktree: '/workspace/minimax',
});

const openCodeSession = (): OpenCodeSessionSummary => ({
    agent: 'review-agent',
    archivedAtMs: TIMESTAMP,
    cost: 0.0042,
    createdAtMs: TIMESTAMP,
    directory: '/tmp/opencode',
    lastUpdatedAtMs: TIMESTAMP,
    messageCount: 42,
    model: { id: 'opencode-model', providerID: null, raw: null, variant: null },
    modelLabel: 'OpenCode model',
    partCount: 8,
    path: null,
    permission: null,
    projectId: 'project-1',
    renderablePartCount: 1,
    sessionId: 'opencode-session',
    slug: 'opencode-review',
    summaryAdditions: null,
    summaryDeletions: null,
    summaryFiles: null,
    textPartCount: 2,
    title: 'OpenCode review',
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensReasoning: 0,
    toolPartCount: 1,
    totalTokens: 2500,
    workspaceKey: 'opencode-key',
    workspaceLabel: 'OpenCode workspace',
    worktree: '/workspace/opencode',
});

const cursorThread = (): CursorThreadSummary => ({
    bubbleBytes: 4096,
    bubbleCount: 12,
    bucketId: 'bucket-1',
    composerId: 'thread-1',
    createdAtMs: TIMESTAMP,
    lastUpdatedAtMs: TIMESTAMP + 100_000,
    latestSnapshotComposerId: null,
    mode: 'agent',
    model: 'claude-fable-5',
    name: 'Fix the checkout flow',
    parentComposerId: null,
    reasoningEffort: 'low',
    snapshotCount: 1,
    status: 'completed',
    transcriptDirs: [],
    workspaceKey: 'folder:/workspace/demo',
    workspaceLabel: 'demo',
});

const codexThread = (): ThreadListEntry => ({
    hierarchy: { childThreadCount: 0, parentThreadId: null },
    modelNames: ['gpt-5.4'],
    project: 'ushman',
    rolloutSizeBytes: 1024,
    stats: { deferred: false, execCommandCount: 1, toolCallCount: 2, webSearchEventCount: 0 },
    thread: {
        agent_nickname: null,
        agent_path: null,
        agent_role: null,
        approval_mode: 'never',
        archived: 0,
        archived_at: null,
        cli_version: '0.1.0',
        created_at: 1,
        created_at_ms: 1,
        cwd: '/workspace/ushman',
        first_user_message: 'How do I continue?',
        git_branch: null,
        git_origin_url: null,
        git_sha: null,
        has_user_event: 1,
        id: 'thread-1',
        memory_mode: 'enabled',
        model: 'gpt-5.4',
        model_provider: 'openai',
        preview: 'How do I continue?',
        reasoning_effort: null,
        rollout_path: '/tmp/thread-1.jsonl',
        sandbox_policy: '{"type":"danger-full-access"}',
        source: 'vscode',
        thread_source: null,
        title: 'Continue reverse engineering',
        tokens_used: 42,
        updated_at: 2,
        updated_at_ms: 2,
    },
});

const antigravityConversation = (): AntigravityConversation => ({
    artifactBytes: 1024,
    artifactCount: 1,
    artifacts: [],
    conversationBytes: 4096,
    conversationId: 'conversation-1',
    conversationMtimeMs: TIMESTAMP,
    conversationPath: '/tmp/conversation.pb',
    createdAtMs: TIMESTAMP,
    hierarchy: { parentConversationId: null },
    indexedItemCount: 7,
    lastUpdatedAtMs: TIMESTAMP + 100_000,
    model: null,
    projectId: null,
    sourceRoot: '/tmp/antigravity',
    summaryPath: '/tmp/summary.pb',
    title: 'Investigate flaky workspace sync',
    totalBytes: 7168,
    transcriptBytes: 2048,
    transcriptEntryCount: 12,
    transcriptPath: '/tmp/overview.txt',
    transcriptSource: 'overview',
    workspaceFolder: '/workspace/demo',
    workspaceKey: 'folder:/workspace/demo',
    workspaceLabel: 'demo',
    workspaceUri: 'file:///workspace/demo',
});

const grokBotChat = (): GrokBotChat => ({
    createdAtMs: TIMESTAMP,
    deepLinks: { native: null, spiracha: '/conversations/grok-bot/chat-id', ui: '/grok-bot-chats/chat-id' },
    id: 'chat-id',
    matches: [],
    messageCount: null,
    messages: [],
    metadata: { chatKind: 'group', members: [{ id: 'kiwi', name: 'Kiwi' }] },
    source: 'grok-bot',
    title: 'Bamba Dev Team',
    updatedAtMs: TIMESTAMP + 100,
    workspaceKey: null,
    workspacePath: null,
});

const webChat = (): WebChatConversationSummary => ({
    createdAtMs: TIMESTAMP,
    fileName: 'claude.json',
    id: 'parsed-id',
    lastActiveAtMs: TIMESTAMP + 1000,
    messageCount: 12,
    model: 'claude-sonnet-4',
    platform: 'Claude',
    sourceConversationId: 'source-id',
    title: 'Imported research',
});

const cloudTask = (): CodexCloudTask => ({
    createdAt: '2026-01-01T00:00:00.000Z',
    diffStats: { filesModified: 1, linesAdded: 2, linesRemoved: 0 },
    environmentId: 'environment-1',
    environmentLabel: 'owner/alpha',
    id: 'task_e_1',
    status: 'ready',
    taskUrl: 'https://chatgpt.com/codex/tasks/task_e_1',
    title: 'Cloud review',
    updatedAt: '2026-01-02T00:00:00.000Z',
});

const sessionBinding = <T extends { sessionId: string; title: string }>(
    row: T,
    href: string,
    render: (row: T, handlers: ListActionHandlers) => ReactElement,
): ListActionBinding => ({
    deleteRowLabel: 'Delete session',
    exportRowLabel: 'Export session',
    href,
    itemLabel: 'session',
    render: (handlers) => render(row, handlers),
    rowId: row.sessionId,
    title: row.title,
});

const SOURCE_LIST_ACTION_BINDINGS = {
    antigravity: {
        deleteRowLabel: 'Delete conversation',
        exportRowLabel: 'Export conversation',
        href: '/antigravity-conversations/conversation-1',
        itemLabel: 'conversation',
        render: (handlers) => {
            const conversation = antigravityConversation();
            return (
                <AntigravityConversationsTable
                    conversations={[conversation]}
                    decryptionState={null}
                    onDeleteConversation={() => handlers.onDeleteRow()}
                    onDeleteConversations={handlers.onDeleteIds}
                    onExportArtifacts={vi.fn()}
                    onExportConversation={() => handlers.onExportRow()}
                    onExportConversations={handlers.onExportIds}
                />
            );
        },
        rowId: 'conversation-1',
        title: 'Investigate flaky workspace sync',
    },
    'claude-code': sessionBinding(claudeSession(), '/claude-code-sessions/claude-session', (session, handlers) => (
        <ClaudeCodeSessionsTable
            sessions={[session]}
            onDeleteSession={() => handlers.onDeleteRow()}
            onDeleteSessions={handlers.onDeleteIds}
            onExportSession={() => handlers.onExportRow()}
            onExportSessions={handlers.onExportIds}
        />
    )),
    cline: {
        deleteRowLabel: 'Delete session',
        exportRowLabel: 'Export session',
        href: '/cline-tasks/1785560414951',
        itemLabel: 'session',
        render: (handlers) => (
            <ClineTasksTable
                sessions={[clineTask()]}
                onDeleteSession={() => handlers.onDeleteRow()}
                onDeleteSessions={handlers.onDeleteIds}
                onExportSession={() => handlers.onExportRow()}
                onExportSessions={handlers.onExportIds}
            />
        ),
        rowId: '1785560414951',
        title: 'Cline review',
    },
    codex: {
        deleteRowLabel: 'Delete thread',
        exportRowLabel: 'Export thread',
        href: '/threads/thread-1',
        itemLabel: 'thread',
        render: (handlers) => (
            <ThreadsTable
                threads={[codexThread()]}
                onDeleteThread={() => handlers.onDeleteRow()}
                onDeleteThreads={handlers.onDeleteIds}
                onExportThread={() => handlers.onExportRow()}
                onExportThreads={handlers.onExportIds}
            />
        ),
        rowId: 'thread-1',
        title: 'Continue reverse engineering',
    },
    'codex-cloud': {
        deleteRowLabel: null,
        exportRowLabel: 'Export',
        href: '/codex/cloud/tasks/task_e_1',
        itemLabel: 'thread',
        linkName: 'Cloud review task_e_1',
        render: (handlers) => (
            <>
                <CodexCloudReadOnlyNotice />
                <CodexCloudTasksTable
                    emptyMessage="No Cloud threads match the current search."
                    tasks={[cloudTask()]}
                    onExportTask={() => handlers.onExportRow()}
                    onExportTasks={handlers.onExportIds}
                />
            </>
        ),
        rowId: 'task_e_1',
        title: 'Cloud review',
    },
    'command-code': sessionBinding(
        commandCodeSession(),
        '/command-code-sessions/command-code-session',
        (session, handlers) => (
            <CommandCodeSessionsTable
                sessions={[session]}
                onDeleteSession={() => handlers.onDeleteRow()}
                onDeleteSessions={handlers.onDeleteIds}
                onExportSession={() => handlers.onExportRow()}
                onExportSessions={handlers.onExportIds}
            />
        ),
    ),
    cursor: {
        deleteRowLabel: 'Delete thread',
        exportRowLabel: 'Export thread',
        href: '/cursor-threads/thread-1',
        itemLabel: 'thread',
        render: (handlers) => (
            <CursorThreadsTable
                threads={[cursorThread()]}
                onDeleteThread={() => handlers.onDeleteRow()}
                onDeleteThreads={handlers.onDeleteIds}
                onExportThread={() => handlers.onExportRow()}
                onExportThreads={handlers.onExportIds}
            />
        ),
        rowId: 'thread-1',
        title: 'Fix the checkout flow',
    },
    fx: sessionBinding(fxSession(), '/fx-sessions/fx-session', (session, handlers) => (
        <FxSessionsTable
            sessions={[session]}
            onDeleteSession={() => handlers.onDeleteRow()}
            onDeleteSessions={handlers.onDeleteIds}
            onExportSession={() => handlers.onExportRow()}
            onExportSessions={handlers.onExportIds}
        />
    )),
    grok: sessionBinding(grokSession(), '/grok-sessions/grok-session', (session, handlers) => (
        <GrokSessionsTable
            sessions={[session]}
            onDeleteSession={() => handlers.onDeleteRow()}
            onDeleteSessions={handlers.onDeleteIds}
            onExportSession={() => handlers.onExportRow()}
            onExportSessions={handlers.onExportIds}
        />
    )),
    'grok-bot': {
        deleteRowLabel: 'Delete chat',
        exportRowLabel: 'Export chat',
        href: '/grok-bot-chats/chat-id',
        itemLabel: 'chat',
        render: (handlers) => (
            <GrokBotChatsTable
                chats={[grokBotChat()]}
                onDeleteChat={() => handlers.onDeleteRow()}
                onDeleteChats={handlers.onDeleteIds}
                onExportChat={() => handlers.onExportRow()}
                onExportChats={handlers.onExportIds}
            />
        ),
        rowId: 'chat-id',
        title: 'Bamba Dev Team',
    },
    kiro: sessionBinding(kiroSession(), '/kiro-sessions/kiro-session', (session, handlers) => (
        <KiroSessionsTable
            sessions={[session]}
            onDeleteSession={() => handlers.onDeleteRow()}
            onDeleteSessions={handlers.onDeleteIds}
            onExportSession={() => handlers.onExportRow()}
            onExportSessions={handlers.onExportIds}
        />
    )),
    'minimax-code': sessionBinding(miniMaxSession(), '/minimax-code-sessions/minimax-session', (session, handlers) => (
        <MiniMaxCodeSessionsTable
            sessions={[session]}
            onDeleteSession={() => handlers.onDeleteRow()}
            onDeleteSessions={handlers.onDeleteIds}
            onExportSession={() => handlers.onExportRow()}
            onExportSessions={handlers.onExportIds}
        />
    )),
    opencode: sessionBinding(openCodeSession(), '/opencode-sessions/opencode-session', (session, handlers) => (
        <OpenCodeSessionsTable
            sessions={[session]}
            onDeleteSession={() => handlers.onDeleteRow()}
            onDeleteSessions={handlers.onDeleteIds}
            onExportSession={() => handlers.onExportRow()}
            onExportSessions={handlers.onExportIds}
        />
    )),
    qoder: sessionBinding(qoderSession(), '/qoder-sessions/task-a.session.execution', (session, handlers) => (
        <QoderSessionsTable
            sessions={[session]}
            onDeleteSession={() => handlers.onDeleteRow()}
            onDeleteSessions={handlers.onDeleteIds}
            onExportSession={() => handlers.onExportRow()}
            onExportSessions={handlers.onExportIds}
        />
    )),
    web: {
        deleteRowLabel: 'Delete chat',
        exportRowLabel: 'Export chat',
        href: '/web-chats/parsed-id',
        itemLabel: 'chat',
        render: (handlers) => (
            <WebConversationsTable
                conversations={[webChat()]}
                onDeleteChat={() => handlers.onDeleteRow()}
                onDeleteChats={handlers.onDeleteIds}
                onExportChat={() => handlers.onExportRow()}
                onExportChats={handlers.onExportIds}
            />
        ),
        rowId: 'parsed-id',
        title: 'Imported research',
    },
} as const satisfies Record<ListActionSurface, ListActionBinding>;

afterEach(() => {
    cleanup();
});

describe('source list action bindings', () => {
    it('should bind every local source plus Web and Cloud without a shared component cast', () => {
        expect([...Object.keys(SOURCE_LIST_ACTION_BINDINGS)].sort()).toEqual(
            [...CONVERSATION_SOURCES, 'codex-cloud', 'web'].sort(),
        );
        expect(CONVERSATION_SOURCES).not.toContain('web');
        expect(CONVERSATION_SOURCES).not.toContain('codex-cloud');
    });

    for (const source of Object.keys(SOURCE_LIST_ACTION_BINDINGS) as ListActionSurface[]) {
        it(`should export and ${SOURCE_LIST_ACTION_BINDINGS[source].deleteRowLabel ? 'delete' : 'explain read-only'} ${source} from its real table`, () => {
            const binding = SOURCE_LIST_ACTION_BINDINGS[source];
            const onDeleteIds = vi.fn();
            const onDeleteRow = vi.fn();
            const onExportIds = vi.fn();
            const onExportRow = vi.fn();
            render(
                binding.render({
                    onDeleteIds,
                    onDeleteRow,
                    onExportIds,
                    onExportRow,
                }),
            );

            expect(
                screen
                    .getByRole('link', { name: binding.linkName ?? new RegExp(binding.title, 'i') })
                    .getAttribute('href'),
            ).toBe(binding.href);
            fireEvent.click(screen.getByRole('checkbox', { name: `Select row ${binding.rowId}` }));
            fireEvent.click(screen.getByRole('button', { name: `Export selected ${binding.itemLabel}` }));
            expect(onExportIds).toHaveBeenCalledWith([binding.rowId]);

            if (binding.deleteRowLabel) {
                fireEvent.click(screen.getByRole('button', { name: `Delete selected ${binding.itemLabel}` }));
                expect(onDeleteIds).toHaveBeenCalledWith([binding.rowId]);
            } else {
                expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
                expect(screen.getByText(/Original files and deletion stay on the Codex Cloud account/)).toBeTruthy();
            }

            fireEvent.click(screen.getByRole('button', { name: `Actions for ${binding.title}` }));
            fireEvent.click(screen.getByRole('button', { name: binding.exportRowLabel }));
            expect(onExportRow).toHaveBeenCalledOnce();
            if (binding.deleteRowLabel) {
                fireEvent.click(screen.getByRole('button', { name: `Actions for ${binding.title}` }));
                fireEvent.click(screen.getByRole('button', { name: binding.deleteRowLabel }));
                expect(onDeleteRow).toHaveBeenCalledOnce();
            }
        });
    }
});
