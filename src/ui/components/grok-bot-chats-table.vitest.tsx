import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GrokBotChat } from '#/lib/grok-bot-server';

vi.mock('@tanstack/react-router', () => ({
    Link: ({
        children,
        className,
        params,
        to,
    }: {
        children: ReactNode;
        className?: string;
        params: { conversationId: string };
        to: string;
    }) => (
        <a className={className} href={to.replace('$conversationId', params.conversationId)}>
            {children}
        </a>
    ),
}));

vi.mock('#/components/ui/dropdown-menu', () => {
    type DropdownMenuState = {
        open: boolean;
        setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    };

    const DropdownMenuContext = React.createContext<DropdownMenuState | null>(null);
    const useDropdownMenuState = () => {
        const context = React.useContext(DropdownMenuContext);
        if (!context) {
            throw new Error('DropdownMenu mock requires a provider');
        }
        return context;
    };

    return {
        DropdownMenu: ({ children }: { children: ReactNode }) => {
            const [open, setOpen] = React.useState(false);
            return <DropdownMenuContext.Provider value={{ open, setOpen }}>{children}</DropdownMenuContext.Provider>;
        },
        DropdownMenuContent: ({ children }: { children: ReactNode }) =>
            useDropdownMenuState().open ? <div>{children}</div> : null,
        DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => {
            const { setOpen } = useDropdownMenuState();
            return (
                <button
                    type="button"
                    onClick={() => {
                        onClick?.();
                        setOpen(false);
                    }}
                >
                    {children}
                </button>
            );
        },
        DropdownMenuTrigger: ({ children }: { children: ReactNode }) => {
            const { setOpen } = useDropdownMenuState();
            if (!React.isValidElement(children)) {
                return null;
            }
            const child = children as React.ReactElement<{
                onClick?: MouseEventHandler<HTMLButtonElement>;
            }>;
            return React.cloneElement(child, {
                onClick: (event) => {
                    child.props.onClick?.(event);
                    setOpen((current) => !current);
                },
            });
        },
    };
});

import { GrokBotChatsTable } from './grok-bot-chats-table';

const chat = (overrides: Partial<GrokBotChat> = {}): GrokBotChat => ({
    createdAtMs: 1_700_000_000_000,
    deepLinks: { native: null, spiracha: '/conversations/grok-bot/chat-id', ui: '/grok-bot-chats/chat-id' },
    id: 'chat-id',
    matches: [],
    messageCount: null,
    messages: [],
    metadata: {
        chatKind: 'group',
        members: [{ id: 'kiwi', name: 'Kiwi' }],
    },
    source: 'grok-bot',
    title: 'Bamba Dev Team',
    updatedAtMs: 1_700_000_000_100,
    workspaceKey: null,
    workspacePath: null,
    ...overrides,
});

afterEach(() => {
    cleanup();
});

describe('GrokBotChatsTable', () => {
    it('should render and operate on global Grok Bot chats without inventing a workspace', () => {
        const onDeleteChat = vi.fn();
        const onDeleteChats = vi.fn();
        const onExportChat = vi.fn();
        const onExportChats = vi.fn();
        const first = chat();
        const second = chat({
            id: 'chat-id-2',
            metadata: { chatKind: 'direct', members: [{ id: 'kiwi', name: 'Kiwi' }] },
            title: 'Kiwi DM',
        });

        render(
            <GrokBotChatsTable
                chats={[first, second]}
                onDeleteChat={onDeleteChat}
                onDeleteChats={onDeleteChats}
                onExportChat={onExportChat}
                onExportChats={onExportChats}
            />,
        );

        expect(screen.getByRole('link', { name: /Bamba Dev Team/i }).getAttribute('href')).toBe(
            '/grok-bot-chats/chat-id',
        );
        expect(screen.getByText('Group')).toBeTruthy();
        expect(screen.getByRole('link', { name: /Kiwi DM/i })).toBeTruthy();
        expect(screen.getAllByText('Kiwi').length).toBeGreaterThan(0);
        expect(screen.getAllByText('n/a').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row chat-id' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export selected chat' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected chat' }));
        expect(onExportChats).toHaveBeenCalledWith(['chat-id']);
        expect(onDeleteChats).toHaveBeenCalledWith(['chat-id']);

        const menuTrigger = screen.getByRole('button', { name: 'Actions for Bamba Dev Team' });
        fireEvent.click(menuTrigger);
        fireEvent.click(screen.getByRole('button', { name: 'Export chat' }));
        fireEvent.click(menuTrigger);
        fireEvent.click(screen.getByRole('button', { name: 'Delete chat' }));
        expect(onExportChat).toHaveBeenCalledWith(first);
        expect(onDeleteChat).toHaveBeenCalledWith(first);
    });

    it('should keep filter-hidden Grok Bot chat ids for batch export without a workspace', () => {
        const onExportChats = vi.fn();
        const first = chat();
        const second = chat({
            id: 'chat-id-2',
            metadata: { chatKind: 'direct', members: [{ id: 'kiwi', name: 'Kiwi' }] },
            title: 'Kiwi DM',
        });
        const tableProps = {
            authoritativeRowIds: [first.id, second.id],
            inventoryIdentity: 'grok-bot',
            onDeleteChat: vi.fn(),
            onDeleteChats: vi.fn(),
            onExportChat: vi.fn(),
            onExportChats,
        };
        const { rerender } = render(<GrokBotChatsTable {...tableProps} chats={[first, second]} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row chat-id' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row chat-id-2' }));
        rerender(<GrokBotChatsTable {...tableProps} chats={[first]} />);

        expect(screen.getByRole('status').textContent).toBe('2 chats selected (1 outside this view)');
        fireEvent.click(screen.getByRole('button', { name: 'Export selected chats' }));
        expect(onExportChats).toHaveBeenCalledWith(['chat-id', 'chat-id-2']);
    });
});
