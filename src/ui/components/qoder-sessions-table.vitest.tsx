import type { QoderSessionSummary } from '@spiracha/lib/qoder-exporter-types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
        className: string;
        params: { sessionId: string };
        to: string;
    }) => (
        <a className={className} href={to.replace('$sessionId', params.sessionId)}>
            {children}
        </a>
    ),
}));

import { QoderSessionsTable } from './qoder-sessions-table';

const buildSession = (model: string): QoderSessionSummary => ({
    agentClass: null,
    assistantMessageCount: 1,
    createdAtIso: null,
    createdAtMs: null,
    executionMode: null,
    fileOperationCount: 0,
    historyIds: ['history-a'],
    lastActiveAtIso: null,
    lastActiveAtMs: 1_700_000_000_000,
    messageCount: 2,
    model,
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
    workspacePath: '/Users/example/workspace/project',
    workspaceStorageId: 'ws-a',
    worktree: '/Users/example/workspace/project',
});

afterEach(() => {
    cleanup();
});

describe('QoderSessionsTable', () => {
    it('should show the resolved model label for each session', () => {
        render(
            <QoderSessionsTable
                sessions={[buildSession('Qwen 3.7 Max')]}
                onExportSession={vi.fn()}
                onExportSessions={vi.fn()}
            />,
        );

        const dataRow = screen.getAllByRole('row')[1]!;
        expect(within(dataRow).getByText('Qwen 3.7 Max')).toBeTruthy();
    });

    it('should allow selecting multiple sessions and trigger batch export', () => {
        const onExportSessions = vi.fn();

        render(
            <QoderSessionsTable
                sessions={[
                    buildSession('Qwen 3.7 Max'),
                    {
                        ...buildSession('Qwen 3.7 Max'),
                        sessionId: 'task-b.session.execution',
                        title: 'Second Qoder review',
                    },
                ]}
                onExportSession={vi.fn()}
                onExportSessions={onExportSessions}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row task-a.session.execution' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row task-b.session.execution' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export selected sessions' }));

        expect(onExportSessions).toHaveBeenCalledWith(['task-a.session.execution', 'task-b.session.execution']);
    });
});
