import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { GrokBotChat } from '#/lib/grok-bot-server';

vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: unknown) => ({ options }),
    Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('#/lib/grok-bot-server', () => ({
    deleteGrokBotChatFn: vi.fn(),
    deleteGrokBotChatsFn: vi.fn(),
    exportGrokBotChatFn: vi.fn(),
    exportGrokBotChatsFn: vi.fn(),
    listGrokBotChatsFn: vi.fn(),
}));

import { deleteGrokBotChatFn, deleteGrokBotChatsFn, listGrokBotChatsFn } from '#/lib/grok-bot-server';
import { Route } from './grok-bot.index';

const chats: GrokBotChat[] = ['gone', 'missing', 'ok', 'retry'].map((id) => ({
    createdAtMs: null,
    deepLinks: { native: null, spiracha: '', ui: '' },
    id,
    matches: [],
    messageCount: null,
    messages: [],
    metadata: {},
    source: 'grok-bot',
    title: id,
    updatedAtMs: null,
    workspaceKey: null,
    workspacePath: null,
}));

afterEach(cleanup);

it('should show partial batch failure and allow retrying only the unresolved chat', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['grok-bot-chats'], chats);
    vi.mocked(listGrokBotChatsFn).mockResolvedValue(chats);
    vi.mocked(deleteGrokBotChatsFn).mockResolvedValue({
        outcomes: [
            { id: 'gone', status: 'deleted' },
            { id: 'missing', status: 'missing' },
            { id: 'ok', status: 'deleted' },
            {
                error: {
                    message:
                        'Grok Bot backend is asleep. Open Grok Bot and wait for it to reconnect, then retry deletion.',
                },
                id: 'retry',
                status: 'failed',
            },
        ],
    } as Awaited<ReturnType<typeof deleteGrokBotChatsFn>>);
    vi.mocked(deleteGrokBotChatFn).mockResolvedValue({ deletedFiles: [], deletedIds: [] });
    const Page = Route.options.component as ComponentType;
    try {
        render(
            <QueryClientProvider client={client}>
                <Page />
            </QueryClientProvider>,
        );
        for (const chat of chats) {
            fireEvent.click(screen.getByRole('checkbox', { name: `Select row ${chat.id}` }));
        }
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected chats' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete chats' }));
        expect(await screen.findByText(/1 chat could not be deleted/)).toBeTruthy();
        expect(screen.getByText(/Grok Bot backend is asleep/)).toBeTruthy();
        const retry = screen.getByRole('button', { name: 'Delete chat' });
        await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(retry);
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(deleteGrokBotChatsFn).toHaveBeenCalledExactlyOnceWith({
            data: { conversationIds: ['gone', 'missing', 'ok', 'retry'] },
        });
        expect(deleteGrokBotChatFn).toHaveBeenCalledExactlyOnceWith({ data: { conversationId: 'retry' } });
    } finally {
        client.clear();
    }
});
