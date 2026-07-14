import type { CursorThreadSummary } from '@spiracha/lib/cursor-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
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
import { formatBytes, formatDateTime, formatNumber } from '#/lib/formatters';

type CursorThreadsTableProps = {
    onDeleteThread: (thread: CursorThreadSummary) => void;
    onDeleteThreads: (composerIds: string[]) => void;
    onExportThread: (thread: CursorThreadSummary) => void;
    onExportThreads: (composerIds: string[]) => void;
    threads: CursorThreadSummary[];
};

const columnHelper = createColumnHelper<CursorThreadSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];

const columns = (
    onDeleteThread: (thread: CursorThreadSummary) => void,
    onExportThread: (thread: CursorThreadSummary) => void,
) =>
    [
        columnHelper.accessor('name', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[20rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ composerId: info.row.original.composerId }}
                    to="/cursor-threads/$composerId"
                >
                    <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                    <p className="truncate text-[var(--muted-foreground)] text-xs">
                        {info.row.original.mode ? `${info.row.original.mode} · ` : ''}
                        {info.row.original.composerId}
                    </p>
                </Link>
            ),
            header: 'Thread',
        }),
        columnHelper.accessor('lastUpdatedAtMs', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Updated',
            id: 'updatedAt',
        }),
        columnHelper.accessor('createdAtMs', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Created',
            id: 'createdAt',
        }),
        columnHelper.accessor('mode', {
            cell: (info) => <span className="font-mono text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Mode',
        }),
        columnHelper.accessor('bubbleCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Messages',
        }),
        columnHelper.accessor('bubbleBytes', {
            cell: (info) => <span className="font-mono text-sm">{formatBytes(info.getValue())}</span>,
            header: 'Size',
        }),
        columnHelper.display({
            cell: (info) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            aria-label={`Actions for ${info.row.original.name}`}
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
                            disabled={info.row.original.bubbleCount === 0}
                            onClick={() => onExportThread(info.row.original)}
                        >
                            <Download className="mr-2 size-4" />
                            Export thread
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-[var(--destructive)]"
                            onClick={() => onDeleteThread(info.row.original)}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete thread
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
            enableSorting: false,
            header: '',
            id: 'actions',
        }),
    ] as const;

export const CursorThreadsTable = ({
    onDeleteThread,
    onDeleteThreads,
    onExportThread,
    onExportThreads,
    threads,
}: CursorThreadsTableProps) => {
    const tableColumns = useMemo(() => columns(onDeleteThread, onExportThread), [onDeleteThread, onExportThread]);

    return (
        <DataTable
            columns={tableColumns}
            data={threads}
            emptyMessage="No Cursor threads match the current workspace filter."
            enableRowSelection
            getRowId={(row) => row.composerId}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => {
                const selectedComposerIds = selectedRows.map((row) => row.composerId);
                const hasEmptySelection = selectedRows.some((row) => row.bubbleCount === 0);
                return (
                    <SelectionActionsToolbar
                        clearSelection={clearSelection}
                        exportDisabled={hasEmptySelection}
                        itemLabel="thread"
                        selectedCount={selectedRows.length}
                        onDeleteSelected={() => onDeleteThreads(selectedComposerIds)}
                        onExportSelected={() => onExportThreads(selectedComposerIds)}
                    />
                );
            }}
        />
    );
};
