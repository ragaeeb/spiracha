import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, MouseEventHandler, ReactNode } from 'react';
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
import { GrokSessionsTable } from './grok-sessions-table';
import { GrokWorkspacesTable } from './grok-workspaces-table';
import { KiroSessionsTable } from './kiro-sessions-table';
import { KiroWorkspacesTable } from './kiro-workspaces-table';
import { OpenCodeSessionsTable } from './opencode-sessions-table';
import { OpenCodeWorkspacesTable } from './opencode-workspaces-table';
import { QoderWorkspacesTable } from './qoder-workspaces-table';

type SessionRow = {
    renderablePartCount: number;
    sessionId: string;
    title: string;
    [key: string]: unknown;
};

type SessionTableProps = {
    onDeleteSession: (session: SessionRow) => void;
    onDeleteSessions: (sessionIds: string[]) => void;
    onExportSession: (session: SessionRow) => void;
    onExportSessions: (sessionIds: string[]) => void;
    sessions: SessionRow[];
};

const sessionSpecs: Array<{
    Component: ComponentType<SessionTableProps>;
    expectedValues: string[];
    route: string;
    session: SessionRow;
}> = [
    {
        Component: ClaudeCodeSessionsTable as unknown as ComponentType<SessionTableProps>,
        expectedValues: ['Claude model', '1,234', '2,500 tokens', '1.0.0'],
        route: '/claude-code-sessions/claude-session',
        session: {
            lastActiveAtMs: 1_700_000_000_000,
            messageCount: 1234,
            model: 'Claude model',
            renderablePartCount: 1,
            sessionId: 'claude-session',
            title: 'Claude review',
            toolCallCount: 12,
            totalTokens: 2500,
            version: '1.0.0',
        },
    },
    {
        Component: GrokSessionsTable as unknown as ComponentType<SessionTableProps>,
        expectedValues: ['Grok model', 'review-agent', '12'],
        route: '/grok-sessions/grok-session',
        session: {
            agentName: 'review-agent',
            currentModelId: 'grok-fallback',
            lastActiveAtMs: 1_700_000_000_000,
            messageCount: 42,
            modelLabel: 'Grok model',
            renderablePartCount: 1,
            sessionId: 'grok-session',
            title: 'Grok review',
            toolCallCount: 12,
        },
    },
    {
        Component: KiroSessionsTable as unknown as ComponentType<SessionTableProps>,
        expectedValues: ['Kiro model', 'spec'],
        route: '/kiro-sessions/kiro-session',
        session: {
            imageCount: 3,
            lastActiveAtMs: 1_700_000_000_000,
            messageCount: 42,
            promptLogCount: 4,
            renderablePartCount: 1,
            selectedModel: 'Kiro model',
            sessionId: 'kiro-session',
            sessionType: 'spec',
            title: 'Kiro review',
        },
    },
    {
        Component: OpenCodeSessionsTable as unknown as ComponentType<SessionTableProps>,
        expectedValues: ['review-agent', 'OpenCode model', '2,500 tokens', '$0.0042', 'archived'],
        route: '/opencode-sessions/opencode-session',
        session: {
            agent: 'review-agent',
            archivedAtMs: 1_700_000_000_000,
            cost: 0.0042,
            lastUpdatedAtMs: 1_700_000_000_000,
            messageCount: 42,
            modelLabel: 'OpenCode model',
            renderablePartCount: 1,
            sessionId: 'opencode-session',
            slug: 'opencode-review',
            title: 'OpenCode review',
            totalTokens: 2500,
        },
    },
];

afterEach(() => {
    cleanup();
});

describe('source session tables', () => {
    for (const { Component, expectedValues, route, session } of sessionSpecs) {
        it(`should render and operate on ${session.title} sessions`, () => {
            const onDeleteSession = vi.fn();
            const onDeleteSessions = vi.fn();
            const onExportSession = vi.fn();
            const onExportSessions = vi.fn();
            render(
                <Component
                    sessions={[session]}
                    onDeleteSession={onDeleteSession}
                    onDeleteSessions={onDeleteSessions}
                    onExportSession={onExportSession}
                    onExportSessions={onExportSessions}
                />,
            );

            expect(screen.getByRole('link', { name: new RegExp(session.title, 'i') }).getAttribute('href')).toBe(route);
            for (const value of expectedValues) {
                expect(screen.getByText(value)).toBeTruthy();
            }

            fireEvent.click(screen.getByRole('checkbox', { name: `Select row ${session.sessionId}` }));
            fireEvent.click(screen.getByRole('button', { name: 'Export selected session' }));
            fireEvent.click(screen.getByRole('button', { name: 'Delete selected session' }));
            expect(onExportSessions).toHaveBeenCalledWith([session.sessionId]);
            expect(onDeleteSessions).toHaveBeenCalledWith([session.sessionId]);

            const menuTrigger = screen.getByRole('button', { name: `Actions for ${session.title}` });
            fireEvent.click(menuTrigger);
            fireEvent.click(screen.getByRole('button', { name: 'Export session' }));
            fireEvent.click(menuTrigger);
            fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
            expect(onExportSession).toHaveBeenCalledWith(session);
            expect(onDeleteSession).toHaveBeenCalledWith(session);
        });
    }
});

describe('source workspace tables', () => {
    it('should render source workspace metrics and navigation links', () => {
        const workspaces = [
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
                Component: OpenCodeWorkspacesTable,
                path: '/opencode/opencode-key',
                row: {
                    key: 'opencode-key',
                    label: 'OpenCode workspace',
                    lastActiveMs: 1_700_000_000_000,
                    messageCount: 20,
                    partCount: 30,
                    sessionCount: 2,
                    worktree: '/workspace/opencode',
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
    });
});
