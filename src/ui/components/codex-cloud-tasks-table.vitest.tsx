import type { CodexCloudTask } from '@spiracha/lib/codex-cloud';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, params, to }: { children: ReactNode; params: { taskId: string }; to: string }) => (
        <a href={to.replace('$taskId', params.taskId)}>{children}</a>
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

import { CodexCloudReadOnlyNotice, CodexCloudTasksTable } from './codex-cloud-tasks-table';

afterEach(() => {
    cleanup();
});

const task = (overrides: Partial<CodexCloudTask> = {}): CodexCloudTask => ({
    createdAt: '2026-01-01T00:00:00.000Z',
    diffStats: { filesModified: 1, linesAdded: 2, linesRemoved: 0 },
    environmentId: 'environment-1',
    environmentLabel: 'owner/alpha',
    id: 'task_e_1',
    status: 'ready',
    taskUrl: 'https://chatgpt.com/codex/tasks/task_e_1',
    title: 'Cloud review',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
});

it('should export Cloud tasks from the current project list without delete or raw actions', () => {
    const onExportTask = vi.fn();
    const onExportTasks = vi.fn();
    const first = task();

    render(
        <>
            <CodexCloudReadOnlyNotice />
            <CodexCloudTasksTable
                emptyMessage="No Cloud threads match the current search."
                tasks={[first]}
                onExportTask={onExportTask}
                onExportTasks={onExportTasks}
            />
        </>,
    );

    expect(screen.getByText(/Original files and deletion stay on the Codex Cloud account/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cloud review task_e_1' }).getAttribute('href')).toBe(
        '/codex/cloud/tasks/task_e_1',
    );
    expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
    expect(screen.getByText('Select threads to export them in a batch.')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row task_e_1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export selected thread' }));
    expect(onExportTasks).toHaveBeenCalledWith(['task_e_1']);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Cloud review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExportTask).toHaveBeenCalledWith(first);
});
