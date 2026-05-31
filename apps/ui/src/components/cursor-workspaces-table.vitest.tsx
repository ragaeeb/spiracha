import type { CursorWorkspaceGroup } from '@spiracha/lib/cursor-exporter-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CursorWorkspacesTable } from './cursor-workspaces-table';

vi.mock('@tanstack/react-router', async () => {
    return {
        Link: ({
            children,
            params,
            to,
            ...props
        }: {
            children: ReactNode;
            params?: { workspaceKey?: string };
            to: string;
        }) => {
            const href = to.replace('$workspaceKey', encodeURIComponent(params?.workspaceKey ?? ''));
            return (
                <a href={href} {...props}>
                    {children}
                </a>
            );
        },
    };
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
            disabled,
            onClick,
        }: {
            children: ReactNode;
            className?: string;
            disabled?: boolean;
            onClick?: () => void;
        }) => {
            const { setOpen } = useDropdownMenuState();
            return (
                <button
                    className={className}
                    disabled={disabled}
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

const workspace: CursorWorkspaceGroup = {
    buckets: [
        {
            bucketId: 'bucket-1',
            composerCount: 2,
            dbPath: '/tmp/state.vscdb',
            dbSizeBytes: 1024,
            folders: ['/Users/user/workspace/demo'],
            globalHeaderCount: 1,
            kind: 'folder',
            label: 'demo',
            mtimeMs: 1_700_000_000_000,
            threadComposerIds: ['thread-1', 'thread-2'],
            uri: 'file:///Users/user/workspace/demo',
            workspaceJsonPath: '/tmp/workspace.json',
        },
    ],
    folders: ['/Users/user/workspace/demo'],
    key: 'folder:/Users/user/workspace/demo',
    kind: 'folder',
    label: 'demo',
    lastActiveMs: 1_700_000_000_000,
    needsRecovery: true,
    threadCount: 2,
    uri: 'file:///Users/user/workspace/demo',
};

afterEach(() => {
    cleanup();
});

describe('CursorWorkspacesTable', () => {
    it('should render workspace links with the detail route href', () => {
        render(
            <CursorWorkspacesTable onDeleteWorkspace={vi.fn()} onRecoverWorkspace={vi.fn()} workspaces={[workspace]} />,
        );

        const link = screen.getByRole('link', { name: /demo/i });
        expect(link.getAttribute('href')).toBe('/cursor/folder%3A%2FUsers%2Fuser%2Fworkspace%2Fdemo');
    });

    it('should expose recover and delete actions from the row menu', async () => {
        const onDeleteWorkspace = vi.fn();
        const onRecoverWorkspace = vi.fn();

        render(
            <CursorWorkspacesTable
                onDeleteWorkspace={onDeleteWorkspace}
                onRecoverWorkspace={onRecoverWorkspace}
                workspaces={[workspace]}
            />,
        );

        expect(screen.getByRole('button', { name: 'Actions for demo' })).toBeTruthy();

        const menuTrigger = screen
            .getAllByRole('button')
            .find((button) => button.getAttribute('aria-haspopup') === 'menu');
        if (!menuTrigger) {
            throw new Error('expected a row action menu trigger');
        }

        fireEvent.click(menuTrigger);
        fireEvent.click(await screen.findByText('Recover workspace'));
        fireEvent.click(menuTrigger);
        fireEvent.click(await screen.findByText('Delete workspace'));

        expect(onRecoverWorkspace).toHaveBeenCalledWith(workspace);
        expect(onDeleteWorkspace).toHaveBeenCalledWith(workspace);
    });
});
