import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, params }: { children: ReactNode; params: { sessionId: string } }) => (
        <a href={`/claude-code-sessions/${params.sessionId}`}>{children}</a>
    ),
}));

import { ClaudeCodeForkBanner } from './claude-code-fork-banner';

afterEach(() => {
    cleanup();
});

describe('ClaudeCodeForkBanner', () => {
    it('should link an earlier branch to the branches rewound from it', () => {
        render(<ClaudeCodeForkBanner forkSessionIds={['fork-a', 'fork-b']} forkedFrom={null} />);

        expect(screen.getByText(/Rewound into a newer branch/)).toBeTruthy();
        expect(screen.getByRole('link', { name: 'fork-a' }).getAttribute('href')).toBe('/claude-code-sessions/fork-a');
        expect(screen.getByRole('link', { name: 'fork-b' })).toBeTruthy();
    });

    it('should link a fork back to the session it branched from', () => {
        render(
            <ClaudeCodeForkBanner
                forkSessionIds={[]}
                forkedFrom={{ branchEntryId: 'entry-1', sessionId: 'original' }}
            />,
        );

        expect(screen.getByText(/Branched from an earlier version/)).toBeTruthy();
        expect(screen.getByRole('link', { name: 'original' }).getAttribute('href')).toBe(
            '/claude-code-sessions/original',
        );
    });

    it('should render nothing for a session without branches', () => {
        const { container } = render(<ClaudeCodeForkBanner forkSessionIds={[]} forkedFrom={null} />);

        expect(container.innerHTML).toBe('');
    });
});
