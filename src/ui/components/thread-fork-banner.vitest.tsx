import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, params }: { children: ReactNode; params: { threadId: string } }) => (
        <a href={`/threads/${params.threadId}`}>{children}</a>
    ),
}));

import { ThreadForkBanner } from './thread-fork-banner';

afterEach(() => {
    cleanup();
});

describe('ThreadForkBanner', () => {
    it('should link a fork to the thread it was forked from', () => {
        render(
            <ThreadForkBanner
                fork={{
                    ordinalExclusive: 3,
                    parentAvailable: true,
                    parentThreadId: 'parent-1',
                    parentTitle: 'Original prompt',
                }}
            />,
        );

        expect(screen.getByText(/This thread is a fork of/)).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Original prompt' }).getAttribute('href')).toBe('/threads/parent-1');
    });

    it('should fall back to the parent id when its title is unknown', () => {
        render(
            <ThreadForkBanner
                fork={{ ordinalExclusive: 3, parentAvailable: true, parentThreadId: 'parent-1', parentTitle: null }}
            />,
        );

        expect(screen.getByRole('link', { name: 'parent-1' })).toBeTruthy();
    });

    it('should explain that a fork whose parent was deleted only has the conversation after the fork', () => {
        render(
            <ThreadForkBanner
                fork={{ ordinalExclusive: 3, parentAvailable: false, parentThreadId: 'gone-1', parentTitle: null }}
            />,
        );

        expect(screen.getByText(/forked from thread gone-1, which no longer exists/)).toBeTruthy();
        expect(screen.getByText(/Export includes the conversation after the fork/)).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('should render nothing for a thread that is not a fork', () => {
        const { container } = render(<ThreadForkBanner fork={null} />);

        expect(container.innerHTML).toBe('');
    });
});
