import type { CursorThreadSummary } from '@spiracha/lib/cursor-exporter-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CursorThreadsTable } from './cursor-threads-table';

vi.mock('@tanstack/react-router', async () => {
    return {
        Link: ({
            children,
            params,
            to,
            ...props
        }: {
            children: ReactNode;
            params?: { composerId?: string };
            to: string;
        }) => {
            const href = to.replace('$composerId', encodeURIComponent(params?.composerId ?? ''));
            return (
                <a href={href} {...props}>
                    {children}
                </a>
            );
        },
    };
});

vi.mock('#/components/data-table', async () => {
    const actual = await vi.importActual<typeof import('./data-table')>('./data-table');
    return actual;
});

vi.mock('#/components/ui/dropdown-menu', async () => {
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
        DropdownMenuContent: ({ children }: { children: ReactNode }) => {
            const { open } = useDropdownMenuState();
            return open ? <div>{children}</div> : null;
        },
        DropdownMenuItem: ({
            children,
            className,
            onClick,
        }: {
            children: ReactNode;
            className?: string;
            onClick?: () => void;
        }) => {
            const { setOpen } = useDropdownMenuState();
            return (
                <button
                    className={className}
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
            const { open, setOpen } = useDropdownMenuState();

            if (React.isValidElement(children)) {
                const child = children as React.ReactElement<{
                    onClick?: MouseEventHandler<HTMLButtonElement>;
                    'aria-expanded'?: boolean;
                    'aria-haspopup'?: string;
                }>;

                return React.cloneElement(child, {
                    'aria-expanded': open,
                    'aria-haspopup': 'menu',
                    onClick: (event) => {
                        child.props.onClick?.(event);
                        setOpen((current) => !current);
                    },
                });
            }

            return (
                <button
                    aria-expanded={open}
                    aria-haspopup="menu"
                    type="button"
                    onClick={() => setOpen((current) => !current)}
                >
                    {children}
                </button>
            );
        },
    };
});

const thread: CursorThreadSummary = {
    bubbleBytes: 4096,
    bubbleCount: 12,
    bucketId: 'bucket-1',
    composerId: 'thread-1',
    createdAtMs: 1_700_000_000_000,
    lastUpdatedAtMs: 1_700_000_100_000,
    mode: 'agent',
    name: 'Fix the checkout flow',
    transcriptDirs: [],
    workspaceKey: 'folder:/Users/user/workspace/demo',
    workspaceLabel: 'demo',
};

afterEach(() => {
    cleanup();
});

describe('CursorThreadsTable', () => {
    it('should render the thread title as a real link for opening in a new tab', () => {
        render(
            <CursorThreadsTable
                onDeleteThread={vi.fn()}
                onDeleteThreads={vi.fn()}
                onExportThread={vi.fn()}
                onExportThreads={vi.fn()}
                threads={[thread]}
            />,
        );

        const link = screen.getByRole('link', { name: /fix the checkout flow/i });
        expect(link.getAttribute('href')).toBe('/cursor-threads/thread-1');
    });

    it('should allow selecting multiple threads and trigger bulk actions', () => {
        const onDeleteThreads = vi.fn();
        const onExportThreads = vi.fn();

        render(
            <CursorThreadsTable
                onDeleteThread={vi.fn()}
                onDeleteThreads={onDeleteThreads}
                onExportThread={vi.fn()}
                onExportThreads={onExportThreads}
                threads={[
                    thread,
                    {
                        ...thread,
                        composerId: 'thread-2',
                        name: 'Refine the tests',
                    },
                ]}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row thread-1' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row thread-2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export selected threads' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected threads' }));

        expect(onExportThreads).toHaveBeenCalledWith(['thread-1', 'thread-2']);
        expect(onDeleteThreads).toHaveBeenCalledWith(['thread-1', 'thread-2']);
    });

    it('should trigger single-thread export and delete actions from the row menu', async () => {
        const onDeleteThread = vi.fn();
        const onExportThread = vi.fn();

        render(
            <CursorThreadsTable
                onDeleteThread={onDeleteThread}
                onDeleteThreads={vi.fn()}
                onExportThread={onExportThread}
                onExportThreads={vi.fn()}
                threads={[thread]}
            />,
        );

        expect(screen.getByRole('button', { name: 'Actions for Fix the checkout flow' })).toBeTruthy();

        const menuTrigger = screen
            .getAllByRole('button')
            .find((button) => button.getAttribute('aria-haspopup') === 'menu');
        if (!menuTrigger) {
            throw new Error('expected a row action menu trigger');
        }

        fireEvent.click(menuTrigger);
        fireEvent.click(await screen.findByText('Export thread'));
        fireEvent.click(menuTrigger);
        fireEvent.click(await screen.findByText('Delete thread'));

        expect(onExportThread).toHaveBeenCalledWith(thread);
        expect(onDeleteThread).toHaveBeenCalledWith(thread);
    });
});
