import type { DashboardRecentThread } from '@spiracha/lib/codex-browser-types';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RecentThreadsList } from './recent-threads-list';

vi.mock('@tanstack/react-router', async () => {
    return {
        Link: ({
            children,
            params,
            to,
            ...props
        }: {
            children: ReactNode;
            params?: { project?: string; threadId?: string };
            to: string;
        }) => {
            const href = to.replace('$threadId', params?.threadId ?? '').replace('$project', params?.project ?? '');
            return (
                <a href={href} {...props}>
                    {children}
                </a>
            );
        },
    };
});

const recentThread: DashboardRecentThread = {
    project: 'spiracha',
    thread: {
        cwd: '/Users/user/workspace/spiracha',
        id: 'thread-1',
        model: 'gpt-5.5',
        preview: 'Build the UI preview',
        title: 'Build the UI',
        tokens_used: 1234,
        updated_at: 1779037924,
        updated_at_ms: null,
    },
};

describe('RecentThreadsList', () => {
    it('should render a right-clickable project link without thread source metadata', () => {
        render(<RecentThreadsList threads={[recentThread]} />);

        expect(screen.getByRole('link', { name: 'Build the UI Build the UI preview' }).getAttribute('href')).toBe(
            '/threads/thread-1',
        );
        expect(screen.getByRole('link', { name: 'spiracha' }).getAttribute('href')).toBe('/codex/spiracha');
        expect(screen.getByText('gpt-5.5')).toBeTruthy();
        expect(screen.getByText('1,234 tokens')).toBeTruthy();
        expect(screen.queryByText('user')).toBeNull();
    });
});
