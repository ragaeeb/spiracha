import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import packageJsonRaw from '../../../../package.json?raw';

const useRouterStateMock = vi.fn();
const packageJson = JSON.parse(packageJsonRaw) as { homepage: string; version: string };

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className, to }: { children: ReactNode; className: string; to: string }) => (
        <a className={className} href={to}>
            {children}
        </a>
    ),
    useRouterState: (input: { select: (state: { location: { pathname: string } }) => string }) =>
        input.select({ location: { pathname: useRouterStateMock() } }),
}));

vi.mock('./theme-toggle', () => ({
    ThemeToggle: () => <div>Theme switcher</div>,
}));

import { AppShell } from './app-shell';

describe('AppShell', () => {
    afterEach(() => {
        cleanup();
    });

    it('should render navigation items and highlight the active section', () => {
        useRouterStateMock.mockReturnValue('/projects/ushman');

        render(
            <AppShell>
                <div>Content area</div>
            </AppShell>,
        );

        expect(screen.getByText('Spiracha Console')).toBeTruthy();
        expect(screen.getByText(`v${packageJson.version}`)).toBeTruthy();
        expect(screen.getByLabelText('Open Spiracha GitHub repository').getAttribute('href')).toBe(
            packageJson.homepage,
        );
        expect(screen.getByText('Theme switcher')).toBeTruthy();
        expect(screen.getByText('Content area')).toBeTruthy();
        expect(screen.getByRole('link', { name: /Codex/i }).className).toContain('bg-[var(--accent-muted)]');
        expect(screen.getByRole('link', { name: /Dashboard/i }).className).toContain(
            'hover:bg-[var(--panel-secondary)]',
        );
        expect(
            screen
                .getAllByRole('link')
                .map((link) => link.textContent)
                .filter(Boolean),
        ).toEqual(['Dashboard', 'Codex', 'Antigravity', 'Cursor', 'OpenCode', 'Analytics', 'Settings']);
    });

    it('should keep Cursor active on standalone thread detail routes', () => {
        useRouterStateMock.mockReturnValue('/cursor-threads/thread-1');

        render(
            <AppShell>
                <div>Content area</div>
            </AppShell>,
        );

        expect(screen.getByRole('link', { name: 'Cursor' }).className).toContain('bg-[var(--accent-muted)]');
    });

    it('should keep Antigravity active on standalone conversation detail routes', () => {
        useRouterStateMock.mockReturnValue('/antigravity-conversations/conversation-1');

        render(
            <AppShell>
                <div>Content area</div>
            </AppShell>,
        );

        expect(screen.getByRole('link', { name: 'Antigravity' }).className).toContain('bg-[var(--accent-muted)]');
    });

    it('should keep OpenCode active on standalone session detail routes', () => {
        useRouterStateMock.mockReturnValue('/opencode-sessions/session-1');

        render(
            <AppShell>
                <div>Content area</div>
            </AppShell>,
        );

        expect(screen.getByRole('link', { name: 'OpenCode' }).className).toContain('bg-[var(--accent-muted)]');
    });
});
