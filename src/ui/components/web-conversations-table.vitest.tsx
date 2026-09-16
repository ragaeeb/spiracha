import type { WebChatConversationSummary } from '@spiracha/lib/web-chat';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, params }: { children: ReactNode; params: { conversationId: string } }) => (
        <a href={`/web-chats/${params.conversationId}`}>{children}</a>
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

import { WebConversationsTable } from './web-conversations-table';

afterEach(() => {
    cleanup();
});

const conversation = (overrides: Partial<WebChatConversationSummary> = {}): WebChatConversationSummary => ({
    createdAtMs: 1_700_000_000_000,
    fileName: 'claude.json',
    id: 'parsed-id',
    lastActiveAtMs: 1_700_000_001_000,
    messageCount: 12,
    model: 'claude-sonnet-4',
    platform: 'Claude',
    sourceConversationId: 'source-id',
    title: 'Imported research',
    ...overrides,
});

it('should export and delete imported chats by parsed id', () => {
    const onDeleteChat = vi.fn();
    const onDeleteChats = vi.fn();
    const onExportChat = vi.fn();
    const onExportChats = vi.fn();
    const first = conversation();

    render(
        <WebConversationsTable
            conversations={[first]}
            onDeleteChat={onDeleteChat}
            onDeleteChats={onDeleteChats}
            onExportChat={onExportChat}
            onExportChats={onExportChats}
        />,
    );

    expect(screen.getByRole('link', { name: /Imported research/i }).getAttribute('href')).toBe('/web-chats/parsed-id');
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-4')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('claude.json')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row parsed-id' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export selected imported conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected imported conversation' }));
    expect(onExportChats).toHaveBeenCalledWith(['parsed-id']);
    expect(onDeleteChats).toHaveBeenCalledWith(['parsed-id']);

    const menuTrigger = screen.getByRole('button', { name: 'Actions for Imported research' });
    fireEvent.click(menuTrigger);
    fireEvent.click(screen.getByRole('button', { name: 'Export chat' }));
    fireEvent.click(menuTrigger);
    fireEvent.click(screen.getByRole('button', { name: 'Remove imported conversation' }));
    expect(onExportChat).toHaveBeenCalledWith(first);
    expect(onDeleteChat).toHaveBeenCalledWith(first);
});
