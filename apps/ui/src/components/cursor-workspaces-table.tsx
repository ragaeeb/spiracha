import type { CursorWorkspaceGroup } from '@spiracha/lib/cursor-exporter-types';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { MoreHorizontal, RefreshCcw, Trash2 } from 'lucide-react';
import { DataTable } from '#/components/data-table';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type CursorWorkspacesTableProps = {
    onDeleteWorkspace: (workspace: CursorWorkspaceGroup) => void;
    onRecoverWorkspace: (workspace: CursorWorkspaceGroup) => void;
    workspaces: CursorWorkspaceGroup[];
};

const columnHelper = createColumnHelper<CursorWorkspaceGroup>();

const getWorkspaceLocation = (workspace: CursorWorkspaceGroup) => workspace.folders[0] ?? workspace.uri;

const getWorkspaceStorageLabel = (workspace: CursorWorkspaceGroup) => {
    if (workspace.buckets.length === 0) {
        return 'File history';
    }

    return `${formatNumber(workspace.buckets.length)} bucket${workspace.buckets.length === 1 ? '' : 's'}`;
};

const getWorkspaceStateLabel = (workspace: CursorWorkspaceGroup) => {
    if (workspace.needsRecovery) {
        return 'Recovery available';
    }

    if (workspace.buckets.length === 0) {
        return 'Activity only';
    }

    return 'Current';
};

const columns = (
    onDeleteWorkspace: (workspace: CursorWorkspaceGroup) => void,
    onRecoverWorkspace: (workspace: CursorWorkspaceGroup) => void,
) =>
    [
        columnHelper.accessor('label', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ workspaceKey: info.row.original.key }}
                    to="/cursor/$workspaceKey"
                >
                    <div className="flex items-center gap-2">
                        <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                        {info.row.original.needsRecovery ? <Badge variant="outline">recover</Badge> : null}
                    </div>
                    <p className="truncate text-[var(--muted-foreground)] text-xs">
                        {getWorkspaceLocation(info.row.original)}
                    </p>
                </Link>
            ),
            header: 'Workspace',
        }),
        columnHelper.accessor('threadCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Threads',
        }),
        columnHelper.display({
            cell: (info) => <span className="text-sm">{getWorkspaceStorageLabel(info.row.original)}</span>,
            header: 'Storage',
            id: 'storage',
        }),
        columnHelper.display({
            cell: (info) => <span className="text-sm">{getWorkspaceStateLabel(info.row.original)}</span>,
            header: 'State',
            id: 'state',
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
                        {info.row.original.needsRecovery ? (
                            <DropdownMenuItem onClick={() => onRecoverWorkspace(info.row.original)}>
                                <RefreshCcw className="mr-2 size-4" />
                                Recover workspace
                            </DropdownMenuItem>
                        ) : null}
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

export const CursorWorkspacesTable = ({
    onDeleteWorkspace,
    onRecoverWorkspace,
    workspaces,
}: CursorWorkspacesTableProps) => {
    return (
        <DataTable
            columns={columns(onDeleteWorkspace, onRecoverWorkspace)}
            data={workspaces}
            emptyMessage="No Cursor workspaces match the current search."
        />
    );
};
