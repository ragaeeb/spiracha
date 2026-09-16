import type { ClaudeCodeSessionSummary } from '@spiracha/lib/claude-code-exporter-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    Link: ({
        children,
        className,
        params,
        search,
        to,
    }: {
        children: ReactNode;
        className?: string;
        params: Record<string, string>;
        search?: Record<string, unknown>;
        to: string;
    }) => {
        let href = to;
        for (const [key, value] of Object.entries(params)) {
            href = href.replace(`$${key}`, value);
        }
        if (search) {
            const query = new URLSearchParams(
                Object.entries(search).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
            );
            href += query.size > 0 ? `?${query}` : '';
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
        DropdownMenuContent: ({ children }: { children: ReactNode }) => {
            return useDropdownMenuState().open ? <div>{children}</div> : null;
        },
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

import { ClaudeCodeSessionsTable } from './claude-code-sessions-table';
import { ClaudeCodeWorkspacesTable } from './claude-code-workspaces-table';
import { ClineWorkspacesTable } from './cline-workspaces-table';
import { CommandCodeSessionsTable } from './command-code-sessions-table';
import { CommandCodeWorkspacesTable } from './command-code-workspaces-table';
import { GrokWorkspacesTable } from './grok-workspaces-table';
import { KiroWorkspacesTable } from './kiro-workspaces-table';
import { OpenCodeWorkspacesTable } from './opencode-workspaces-table';
import { QoderWorkspacesTable } from './qoder-workspaces-table';

const claudeNestedSession = (overrides: Partial<ClaudeCodeSessionSummary> = {}): ClaudeCodeSessionSummary => ({
    assistantMessageCount: 1,
    attachmentCount: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    continuationSessionIds: [],
    createdAtIso: null,
    createdAtMs: 1_700_000_000_000,
    cwd: '/workspace/claude',
    filePath: '/tmp/claude.jsonl',
    gitBranch: null,
    hierarchy: { parentSessionId: null },
    inputTokens: 0,
    lastActiveAtIso: null,
    lastActiveAtMs: 1_700_000_000_000,
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
    ...overrides,
});

afterEach(() => {
    cleanup();
});

describe('source session tables', () => {
    it('should select Command Code sessions and export from the toolbar or row menu', () => {
        const onDeleteSession = vi.fn();
        const onDeleteSessions = vi.fn();
        const onExportSession = vi.fn();
        const onExportSessions = vi.fn();
        const session = {
            assistantMessageCount: 1,
            createdAtMs: 1_700_000_000_000,
            cwd: '/workspace/command-code',
            filePath: '/tmp/command-code/session.jsonl',
            lastActiveAtMs: 1_700_000_000_100,
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
        };
        const secondSession = {
            ...session,
            sessionId: 'command-code-session-2',
            title: 'Command Code follow-up',
        };

        render(
            <CommandCodeSessionsTable
                onDeleteSession={onDeleteSession}
                onDeleteSessions={onDeleteSessions}
                onExportSession={onExportSession}
                onExportSessions={onExportSessions}
                sessions={[session, secondSession]}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row command-code-session' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row command-code-session-2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export selected sessions' }));
        expect(onExportSessions).toHaveBeenCalledWith(['command-code-session', 'command-code-session-2']);
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected sessions' }));
        expect(onDeleteSessions).toHaveBeenCalledWith(['command-code-session', 'command-code-session-2']);

        fireEvent.click(screen.getByRole('button', { name: 'Actions for Command Code review' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export session' }));
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Command Code review' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
        expect(onExportSession).toHaveBeenCalledWith(session);
        expect(onDeleteSession).toHaveBeenCalledWith(session);
    });

    it('should keep filter-hidden Command Code session ids for batch export', () => {
        const onExportSessions = vi.fn();
        const session = {
            assistantMessageCount: 1,
            createdAtMs: 1_700_000_000_000,
            cwd: '/workspace/command-code',
            filePath: '/tmp/command-code/session.jsonl',
            lastActiveAtMs: 1_700_000_000_100,
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
        };
        const secondSession = {
            ...session,
            sessionId: 'command-code-session-2',
            title: 'Command Code follow-up',
        };
        const tableProps = {
            authoritativeRowIds: [session.sessionId, secondSession.sessionId],
            inventoryIdentity: 'command-code:command-code-key',
            onDeleteSession: vi.fn(),
            onDeleteSessions: vi.fn(),
            onExportSession: vi.fn(),
            onExportSessions,
        };
        const { rerender } = render(<CommandCodeSessionsTable {...tableProps} sessions={[session, secondSession]} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row command-code-session' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row command-code-session-2' }));
        rerender(<CommandCodeSessionsTable {...tableProps} sessions={[session]} />);

        expect(screen.getByRole('status').textContent).toBe('2 sessions selected (1 outside this view)');
        fireEvent.click(screen.getByRole('button', { name: 'Export selected sessions' }));
        expect(onExportSessions).toHaveBeenCalledWith(['command-code-session', 'command-code-session-2']);
    });

    it('should render Claude Code sub-agents as nested rows beneath their parent', () => {
        const parent = claudeNestedSession({
            sessionId: 'parent-session',
            title: 'Fingerprint Wave 1 behavioral fixes',
        });
        const child = claudeNestedSession({
            hierarchy: { parentSessionId: 'parent-session' },
            model: 'claude-opus-5',
            sessionId: 'agent-a1d79cbf732582863',
            title: 'Implement fingerprint #100 and #101',
        });
        const grandchild = claudeNestedSession({
            hierarchy: { parentSessionId: 'agent-a1d79cbf732582863' },
            model: 'claude-opus-5',
            sessionId: 'agent-7f8e90e8',
            title: 'Follow-up review for #101',
        });

        render(
            <ClaudeCodeSessionsTable
                sessions={[parent, child, grandchild]}
                onDeleteSession={vi.fn()}
                onDeleteSessions={vi.fn()}
                onExportSession={vi.fn()}
                onExportSessions={vi.fn()}
            />,
        );

        const childLink = screen.getByRole('link', { name: /Implement fingerprint #100 and #101/ });
        const grandchildLink = screen.getByRole('link', { name: /Follow-up review for #101/ });
        expect(childLink.closest('[data-row-depth="1"]')).toBeTruthy();
        expect(childLink.closest('[data-row-depth="0"]')).toBeNull();
        expect(grandchildLink.closest('[data-row-depth="2"]')).toBeTruthy();
        expect((childLink.closest('[data-row-depth="1"]') as HTMLElement | null)?.style.paddingLeft).toBe('0.75rem');
        expect((grandchildLink.closest('[data-row-depth="2"]') as HTMLElement | null)?.style.paddingLeft).toBe(
            '1.5rem',
        );
        expect(screen.getAllByText('Claude Opus 5')).toHaveLength(2);
    });
});

describe('source workspace tables', () => {
    it('should render source workspace metrics and navigation links', () => {
        const workspaces = [
            {
                Component: ClineWorkspacesTable,
                path: '/cline/cline-key',
                row: {
                    key: 'cline-key',
                    label: 'Cline workspace',
                    lastActiveAtMs: 1_700_000_000_000,
                    messageCount: 20,
                    taskCount: 2,
                    toolCallCount: 3,
                    worktree: '/workspace/cline',
                },
            },
            {
                Component: ClaudeCodeWorkspacesTable,
                path: '/claude-code/claude-key',
                row: {
                    key: 'claude-key',
                    label: 'Claude workspace',
                    lastActiveAtMs: 1_700_000_000_000,
                    messageCount: 20,
                    sessionCount: 2,
                    toolCallCount: 3,
                    worktree: '/workspace/claude',
                },
            },
            {
                Component: GrokWorkspacesTable,
                path: '/grok/grok-key',
                row: {
                    key: 'grok-key',
                    label: 'Grok workspace',
                    lastActiveAtMs: 1_700_000_000_000,
                    messageCount: 20,
                    sessionCount: 2,
                    toolCallCount: 3,
                    worktree: '/workspace/grok',
                },
            },
            {
                Component: KiroWorkspacesTable,
                path: '/kiro/kiro-key',
                row: {
                    imageCount: 3,
                    key: 'kiro-key',
                    label: 'Kiro workspace',
                    lastActiveAtMs: 1_700_000_000_000,
                    messageCount: 20,
                    sessionCount: 2,
                    worktree: '/workspace/kiro',
                },
            },
            {
                Component: CommandCodeWorkspacesTable,
                path: '/command-code/command-code-key',
                row: {
                    assistantMessageCount: 3,
                    key: 'command-code-key',
                    label: 'Command Code workspace',
                    lastActiveAtMs: 1_700_000_000_000,
                    messageCount: 20,
                    sessionCount: 2,
                    toolCallCount: 3,
                    toolOutputCount: 3,
                    userMessageCount: 2,
                    worktree: '/workspace/command-code',
                },
            },
            {
                Component: QoderWorkspacesTable,
                path: '/qoder/qoder-key',
                row: {
                    fileOperationCount: 3,
                    key: 'qoder-key',
                    label: 'Qoder workspace',
                    lastActiveAtMs: 1_700_000_000_000,
                    messageCount: 20,
                    sessionCount: 2,
                    snapshotFileCount: 4,
                    worktree: '/workspace/qoder',
                },
            },
        ] as const;

        for (const { Component, path, row } of workspaces) {
            const { unmount } = render(<Component workspaces={[row] as never} />);
            expect(screen.getByRole('link', { name: new RegExp(row.label, 'i') }).getAttribute('href')).toBe(path);
            expect(screen.getByText(row.worktree)).toBeTruthy();
            unmount();
        }

        const { unmount: unmountOpenCode } = render(
            <OpenCodeWorkspacesTable
                onDeleteWorkspace={vi.fn()}
                onDeleteWorkspaces={vi.fn()}
                workspaces={[
                    {
                        archivedSessionCount: 0,
                        key: 'opencode-key',
                        label: 'OpenCode workspace',
                        lastActiveMs: 1_700_000_000_000,
                        messageCount: 20,
                        partCount: 30,
                        projectId: 'opencode-key',
                        sessionCount: 2,
                        uri: 'file:///workspace/opencode',
                        worktree: '/workspace/opencode',
                    },
                ]}
            />,
        );
        expect(screen.getByRole('link', { name: /OpenCode workspace/i }).getAttribute('href')).toBe(
            '/opencode/opencode-key',
        );
        expect(screen.getByText('/workspace/opencode')).toBeTruthy();
        unmountOpenCode();
    });

    it('should render Command Code session metadata and navigation', () => {
        render(
            <CommandCodeSessionsTable
                onDeleteSession={vi.fn()}
                onDeleteSessions={vi.fn()}
                onExportSession={vi.fn()}
                onExportSessions={vi.fn()}
                sessions={[
                    {
                        assistantMessageCount: 1,
                        createdAtMs: 1_700_000_000_000,
                        cwd: '/workspace/command-code',
                        filePath: '/tmp/session.jsonl',
                        lastActiveAtMs: 1_700_000_000_100,
                        messageCount: 2,
                        model: 'z-ai/glm-5.3-flash',
                        modelLabel: null,
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
                    },
                ]}
            />,
        );

        expect(screen.getByRole('link', { name: /Command Code review/i }).getAttribute('href')).toBe(
            '/command-code-sessions/command-code-session',
        );
        expect(screen.getByText('unknown')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.getByText('1')).toBeTruthy();
    });
});
