import type { ThreadListEntry } from '@spiracha/lib/codex-browser-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadsTable } from './threads-table';

vi.mock('@tanstack/react-router', async () => {
    const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
    return {
        ...actual,
        Link: ({
            children,
            params,
            to,
            ...props
        }: {
            children: ReactNode;
            params?: { threadId?: string };
            to: string;
        }) => {
            const href = to.replace('$threadId', params?.threadId ?? '');
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
    const React = await vi.importActual<typeof import('react')>('react');

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

const threadEntry: ThreadListEntry = {
    project: 'ushman',
    rolloutSizeBytes: 3 * 1024 * 1024 * 1024,
    stats: {
        deferred: false,
        execCommandCount: 1,
        toolCallCount: 2,
        webSearchEventCount: 0,
    },
    thread: {
        agent_nickname: null,
        agent_path: null,
        agent_role: null,
        approval_mode: 'never',
        archived: 0,
        archived_at: null,
        cli_version: '0.1.0',
        created_at: 1,
        created_at_ms: 1,
        cwd: '/Users/user/workspace/ushman',
        first_user_message: 'How do I continue?',
        git_branch: null,
        git_origin_url: null,
        git_sha: null,
        has_user_event: 1,
        id: 'thread-1',
        memory_mode: 'enabled',
        model: 'gpt-5.4',
        model_provider: 'openai',
        preview: 'How do I continue?',
        reasoning_effort: null,
        rollout_path: '/tmp/thread-1.jsonl',
        sandbox_policy: '{"type":"danger-full-access"}',
        source: 'vscode',
        thread_source: null,
        title: 'Continue reverse engineering',
        tokens_used: 42,
        updated_at: 2,
        updated_at_ms: 2,
    },
};

afterEach(() => {
    cleanup();
});

describe('ThreadsTable', () => {
    it('should allow selecting multiple threads and trigger bulk actions', () => {
        const onDeleteThreads = vi.fn();
        const onExportThreads = vi.fn();

        render(
            <ThreadsTable
                onDeleteThread={vi.fn()}
                onDeleteThreads={onDeleteThreads}
                onExportThread={vi.fn()}
                onExportThreads={onExportThreads}
                threads={[
                    threadEntry,
                    {
                        ...threadEntry,
                        thread: {
                            ...threadEntry.thread,
                            id: 'thread-2',
                            title: 'Second thread',
                        },
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

    it('should render the thread title as a real link for opening in a new tab', () => {
        render(
            <ThreadsTable
                onDeleteThread={vi.fn()}
                onDeleteThreads={vi.fn()}
                onExportThread={vi.fn()}
                onExportThreads={vi.fn()}
                threads={[threadEntry]}
            />,
        );

        const link = screen.getAllByRole('link', { name: /continue reverse engineering/i })[0]!;
        expect(link.getAttribute('href')).toBe('/threads/thread-1');
    });

    it('should show deferred tool stats when transcript parsing is skipped', () => {
        render(
            <ThreadsTable
                onDeleteThread={vi.fn()}
                onDeleteThreads={vi.fn()}
                onExportThread={vi.fn()}
                onExportThreads={vi.fn()}
                threads={[
                    {
                        ...threadEntry,
                        stats: {
                            ...threadEntry.stats,
                            deferred: true,
                            toolCallCount: 0,
                        },
                    },
                ]}
            />,
        );

        expect(screen.getByText('Deferred')).toBeTruthy();
    });

    it('should show the rollout size in the table', () => {
        render(
            <ThreadsTable
                onDeleteThread={vi.fn()}
                onDeleteThreads={vi.fn()}
                onExportThread={vi.fn()}
                onExportThreads={vi.fn()}
                threads={[threadEntry]}
            />,
        );

        expect(screen.getAllByText('3.0 GB').length).toBeGreaterThan(0);
    });

    it('should trigger single-thread export and delete actions from the row menu', async () => {
        const onDeleteThread = vi.fn();
        const onExportThread = vi.fn();

        render(
            <ThreadsTable
                onDeleteThread={onDeleteThread}
                onDeleteThreads={vi.fn()}
                onExportThread={onExportThread}
                onExportThreads={vi.fn()}
                threads={[threadEntry]}
            />,
        );

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

        expect(onExportThread).toHaveBeenCalledWith(threadEntry);
        expect(onDeleteThread).toHaveBeenCalledWith(threadEntry);
    });
});
