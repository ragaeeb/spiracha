import type { ProjectSummary } from '@spiracha/lib/codex-browser-types';
import { cleanup, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectsTable } from './projects-table';

vi.mock('@tanstack/react-router', async () => {
    return {
        Link: ({
            children,
            params,
            to,
            ...props
        }: {
            children: ReactNode;
            params?: { project?: string };
            to: string;
        }) => {
            const href = to.replace('$project', params?.project ?? '');
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

const project: ProjectSummary = {
    archivedThreadCount: 1,
    cwdPaths: ['/Users/user/workspace/demo'],
    lastUpdatedAtMs: 1234,
    modelNames: ['gpt-5'],
    name: 'demo',
    threadCount: 3,
    totalTokens: 42,
};

afterEach(() => {
    cleanup();
});

describe('ProjectsTable', () => {
    it('should render the project title as a real link for opening in a new tab', () => {
        render(<ProjectsTable onDeleteProject={vi.fn()} projects={[project]} />);

        const link = screen.getByRole('link', { name: /demo/i });
        expect(link.getAttribute('href')).toBe('/projects/demo');
    });
});
