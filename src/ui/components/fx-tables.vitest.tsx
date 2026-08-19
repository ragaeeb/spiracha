import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, params, to }: { children: ReactNode; params: Record<string, string>; to: string }) => {
        let href = to;
        for (const [key, value] of Object.entries(params)) {
            href = href.replace(`$${key}`, value);
        }
        return <a href={href}>{children}</a>;
    },
}));

import { FxSessionsTable } from './fx-sessions-table';
import { FxWorkspacesTable } from './fx-workspaces-table';

afterEach(cleanup);

describe('FX tables', () => {
    it('should render workspace metrics and navigation', () => {
        render(
            <FxWorkspacesTable
                workspaces={[
                    {
                        assistantMessageCount: 3,
                        key: 'workspace-key',
                        label: 'Migration',
                        lastActiveAtMs: 1_700_000_000_000,
                        messageCount: 4,
                        reasoningCount: 0,
                        sessionCount: 1,
                        toolCallCount: 2,
                        toolResultCount: 2,
                        uri: 'file:///workspace/migration',
                        userMessageCount: 1,
                        worktree: '/workspace/migration',
                    },
                ]}
            />,
        );

        expect(screen.getByRole('link', { name: /Migration/i }).getAttribute('href')).toBe('/fx/workspace-key');
        expect(screen.getByText('/workspace/migration')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
    });

    it('should expose row and bulk export and delete actions', async () => {
        const onDeleteSession = vi.fn();
        const onDeleteSessions = vi.fn();
        const onExportSession = vi.fn();
        const onExportSessions = vi.fn();
        const session = {
            assistantMessageCount: 3,
            conversationLanguage: 'en',
            createdAtMs: 1_700_000_000_000,
            currentModelId: 'anthropic/claude-opus-4.1',
            currentModelVariant: 'high',
            lastActiveAtMs: 1_700_000_000_000,
            messageCount: 4,
            reasoningCount: 0,
            renderablePartCount: 8,
            sessionDir: '/tmp/.fx/sessions/session-1',
            sessionId: 'session-1',
            status: 'complete',
            title: 'Implement migration',
            toolCallCount: 2,
            toolResultCount: 2,
            totalInputTokens: 100,
            totalOutputTokens: 50,
            userMessageCount: 1,
            workspaceKey: 'workspace-key',
            workspaceLabel: 'Migration',
            worktree: '/workspace/migration',
        };

        render(
            <FxSessionsTable
                sessions={[session]}
                onDeleteSession={onDeleteSession}
                onDeleteSessions={onDeleteSessions}
                onExportSession={onExportSession}
                onExportSessions={onExportSessions}
            />,
        );

        expect(screen.getByRole('link', { name: /Implement migration/i }).getAttribute('href')).toBe(
            '/fx-sessions/session-1',
        );
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Implement migration' }), {
            button: 0,
            ctrlKey: false,
            pointerType: 'mouse',
        });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Export session' }));
        expect(onExportSession).toHaveBeenCalledWith(session);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row session-1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export selected session' }));
        expect(onExportSessions).toHaveBeenCalledWith(['session-1']);
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected session' }));
        expect(onDeleteSessions).toHaveBeenCalledWith(['session-1']);
    });
});
