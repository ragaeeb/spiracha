import type { OpenCodeWorkspaceGroup } from '@spiracha/lib/opencode-exporter-types';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { SelectionActionsToolbar } from '#/components/selection-actions-toolbar';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type OpenCodeWorkspacesTableProps = {
    onDeleteWorkspace?: (workspace: OpenCodeWorkspaceGroup) => void;
    onDeleteWorkspaces?: (workspaces: OpenCodeWorkspaceGroup[]) => void;
    workspaces: OpenCodeWorkspaceGroup[];
};

const columnHelper = createDataTableColumnHelper<OpenCodeWorkspaceGroup>();

const columns = (onDeleteWorkspace: (workspace: OpenCodeWorkspaceGroup) => void) =>
    [
        columnHelper.accessor('label', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ workspaceKey: info.row.original.key }}
                    to="/opencode/$workspaceKey"
                >
                    <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                    <p className="truncate text-[var(--muted-foreground)] text-xs">{info.row.original.worktree}</p>
                </Link>
            ),
            header: 'Workspace',
        }),
        columnHelper.accessor('sessionCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Sessions',
        }),
        columnHelper.accessor('messageCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Messages',
        }),
        columnHelper.accessor('partCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Parts',
        }),
        columnHelper.accessor('lastActiveMs', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Last updated',
        }),
        columnHelper.display({
            cell: (info) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            aria-label={`Actions for ${info.row.original.label}`}
                            className="rounded-full"
                            size="icon"
                            type="button"
                            variant="ghost"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            className="text-[var(--destructive)]"
                            onClick={() => onDeleteWorkspace(info.row.original)}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete workspace
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
            header: '',
            id: 'actions',
        }),
    ] as const;

export const OpenCodeWorkspacesTable = ({
    onDeleteWorkspace,
    onDeleteWorkspaces,
    workspaces,
}: OpenCodeWorkspacesTableProps) => {
    const tableColumns = useMemo(() => columns(onDeleteWorkspace ?? (() => undefined)), [onDeleteWorkspace]);

    return (
        <DataTable
            columns={tableColumns}
            data={workspaces}
            emptyMessage="No OpenCode workspaces match the current search."
            enableRowSelection
            getRowId={(row) => row.key}
            renderToolbar={({ clearSelection, selectedRows }) => (
                <SelectionActionsToolbar
                    clearSelection={clearSelection}
                    itemLabel="workspace"
                    selectedCount={selectedRows.length}
                    onDeleteSelected={onDeleteWorkspaces ? () => onDeleteWorkspaces(selectedRows) : undefined}
                />
            )}
        />
    );
};
