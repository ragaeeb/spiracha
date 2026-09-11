import type { OpenCodeWorkspaceGroup } from '@spiracha/lib/opencode-exporter-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeWorkspacesTable } from './opencode-workspaces-table';

vi.mock('@tanstack/react-router', () => ({
    Link: ({
        children,
        params,
        to,
        ...props
    }: {
        children: ReactNode;
        params?: { workspaceKey?: string };
        to: string;
    }) => (
        <a href={to.replace('$workspaceKey', encodeURIComponent(params?.workspaceKey ?? ''))} {...props}>
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
            const { open, setOpen } = useDropdownMenuState();
            if (!React.isValidElement(children)) {
                return null;
            }
            const child = children as React.ReactElement<{
                'aria-expanded'?: boolean;
                'aria-haspopup'?: string;
                onClick?: MouseEventHandler<HTMLButtonElement>;
            }>;
            return React.cloneElement(child, {
                'aria-expanded': open,
                'aria-haspopup': 'menu',
                onClick: (event) => {
                    child.props.onClick?.(event);
                    setOpen((current) => !current);
                },
            });
        },
    };
});

const workspace: OpenCodeWorkspaceGroup = {
    archivedSessionCount: 0,
    key: 'project:workspace-a',
    label: 'OpenCode workspace',
    lastActiveMs: 1_700_000_000_000,
    messageCount: 20,
    partCount: 30,
    projectId: 'workspace-a',
    sessionCount: 2,
    uri: 'file:///workspace/opencode',
    worktree: '/workspace/opencode',
};

const otherWorkspace: OpenCodeWorkspaceGroup = {
    ...workspace,
    key: 'project:workspace-b',
    label: 'Other OpenCode workspace',
    projectId: 'workspace-b',
};

afterEach(() => {
    cleanup();
});

describe('OpenCodeWorkspacesTable', () => {
    it('should render a workspace link and expose its delete action', async () => {
        const onDeleteWorkspace = vi.fn();

        render(
            <OpenCodeWorkspacesTable
                onDeleteWorkspace={onDeleteWorkspace}
                onDeleteWorkspaces={vi.fn()}
                workspaces={[workspace]}
            />,
        );

        expect(screen.getByRole('link', { name: /OpenCode workspace/i }).getAttribute('href')).toBe(
            '/opencode/project%3Aworkspace-a',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Actions for OpenCode workspace' }));
        fireEvent.click(await screen.findByText('Delete workspace'));

        expect(onDeleteWorkspace).toHaveBeenCalledWith(workspace);
    });

    it('should request deletion for selected workspaces as a batch', () => {
        const onDeleteWorkspaces = vi.fn();

        render(
            <OpenCodeWorkspacesTable
                onDeleteWorkspace={vi.fn()}
                onDeleteWorkspaces={onDeleteWorkspaces}
                workspaces={[workspace, otherWorkspace]}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: `Select row ${workspace.key}` }));
        fireEvent.click(screen.getByRole('checkbox', { name: `Select row ${otherWorkspace.key}` }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected workspaces' }));

        expect(onDeleteWorkspaces).toHaveBeenCalledWith([workspace, otherWorkspace]);
    });
});
