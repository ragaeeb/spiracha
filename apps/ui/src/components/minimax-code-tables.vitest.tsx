import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { MiniMaxCodeSessionsTable } from './minimax-code-sessions-table';
import { MiniMaxCodeWorkspacesTable } from './minimax-code-workspaces-table';

afterEach(() => {
    cleanup();
});

describe('MiniMax Code tables', () => {
    it('should render workspace metrics and navigation', () => {
        render(
            <MiniMaxCodeWorkspacesTable
                workspaces={[
                    {
                        assistantMessageCount: 3,
                        key: 'workspace-key',
                        label: 'Ushman',
                        lastActiveAtMs: 1_700_000_000_000,
                        messageCount: 4,
                        reasoningCount: 2,
                        sessionCount: 1,
                        toolCallCount: 2,
                        toolResultCount: 2,
                        uri: 'file:///workspace/ushman',
                        userMessageCount: 1,
                        worktree: '/workspace/ushman',
                    },
                ]}
            />,
        );

        expect(screen.getByRole('link', { name: /Ushman/i }).getAttribute('href')).toBe('/minimax-code/workspace-key');
        expect(screen.getByText('/workspace/ushman')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
    });

    it('should export one or multiple selected sessions without exposing delete actions', () => {
        const onExportSession = vi.fn();
        const onExportSessions = vi.fn();
        const session = {
            agentName: 'main',
            appMode: 'coding',
            archived: false,
            assistantMessageCount: 3,
            createdAtMs: 1_700_000_000_000,
            currentModelId: 'minimax/MiniMax-M3',
            currentModelVariant: 'thinking',
            lastActiveAtMs: 1_700_000_000_000,
            messageCount: 4,
            reasoningCount: 2,
            renderablePartCount: 10,
            runtime: 'pi-agent',
            sessionDir: '/tmp/session',
            sessionId: 'mvs_session',
            sessionType: 'branch',
            snapshotPath: '/tmp/session/snapshot.json',
            status: 'finished',
            title: 'Refactor evidence extraction',
            toolCallCount: 2,
            toolResultCount: 2,
            userMessageCount: 1,
            workspaceKey: 'workspace-key',
            workspaceLabel: 'Ushman',
            worktree: '/workspace/ushman',
        };

        render(
            <MiniMaxCodeSessionsTable
                sessions={[session]}
                onExportSession={onExportSession}
                onExportSessions={onExportSessions}
            />,
        );

        expect(screen.getByRole('link', { name: /Refactor evidence extraction/i }).getAttribute('href')).toBe(
            '/minimax-code-sessions/mvs_session',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Export Refactor evidence extraction' }));
        expect(onExportSession).toHaveBeenCalledWith(session);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row mvs_session' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export selected session' }));
        expect(onExportSessions).toHaveBeenCalledWith(['mvs_session']);
        expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
    });
});
