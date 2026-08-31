import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, params }: { children: ReactNode; params: { conversationId: string } }) => (
        <a href={`/web-chats/${params.conversationId}`}>{children}</a>
    ),
}));

import { WebConversationsTable } from './web-conversations-table';

it('should link imported conversations to their parsed transcript routes', () => {
    render(
        <WebConversationsTable
            conversations={[
                {
                    createdAtMs: 1_700_000_000_000,
                    fileName: 'claude.json',
                    id: 'parsed-id',
                    lastActiveAtMs: 1_700_000_001_000,
                    messageCount: 12,
                    model: 'claude-sonnet-4',
                    platform: 'Claude',
                    sourceConversationId: 'source-id',
                    title: 'Imported research',
                },
            ]}
        />,
    );

    expect(screen.getByRole('link', { name: /Imported research/i }).getAttribute('href')).toBe('/web-chats/parsed-id');
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-4')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('claude.json')).toBeTruthy();
});
