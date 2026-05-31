import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const useRouterStateMock = vi.fn();

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
    it('should render navigation items and highlight the active section', () => {
        useRouterStateMock.mockReturnValue('/projects/ushman');

        render(
            <AppShell>
                <div>Content area</div>
            </AppShell>,
        );

        expect(screen.getByText('Spiracha Console')).toBeTruthy();
        expect(screen.getByText('Theme switcher')).toBeTruthy();
        expect(screen.getByText('Content area')).toBeTruthy();
        expect(screen.getByRole('link', { name: /Codex/i }).className).toContain('bg-[var(--accent-muted)]');
        expect(screen.getByRole('link', { name: /Dashboard/i }).className).toContain(
            'hover:bg-[var(--panel-secondary)]',
        );
        expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
            'Dashboard',
            'Codex',
            'Antigravity',
            'Cursor',
            'Analytics',
            'Settings',
        ]);
    });
});
