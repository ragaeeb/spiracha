import type { CursorThreadSummary } from '@spiracha/lib/cursor-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, MoreHorizontal, Trash2, X } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
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

export function CursorThreadsTable({
    onDeleteThread,
    onDeleteThreads,
    onExportThread,
    onExportThreads,
    threads,
}: CursorThreadsTableProps) {
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
                if (selectedRows.length === 0) {
                    return (
                        <p className="text-[var(--muted-foreground)] text-sm">
                            Select threads to export or delete them in a batch.
                        </p>
                    );
                }

                const selectedComposerIds = selectedRows.map((row) => row.composerId);
                const hasEmptySelection = selectedRows.some((row) => row.bubbleCount === 0);
                return (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm">
                            {selectedRows.length} thread{selectedRows.length === 1 ? '' : 's'} selected
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                className="rounded-full"
                                disabled={hasEmptySelection}
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => onExportThreads(selectedComposerIds)}
                            >
                                <Download className="mr-2 size-4" />
                                Export selected threads
                            </Button>
                            <Button
                                className="rounded-full border-[var(--destructive)]/20 text-[var(--destructive)]"
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => onDeleteThreads(selectedComposerIds)}
                            >
                                <Trash2 className="mr-2 size-4" />
                                Delete selected threads
                            </Button>
                            <Button
                                className="rounded-full"
                                size="sm"
                                type="button"
                                variant="ghost"
                                onClick={clearSelection}
                            >
                                <X className="mr-2 size-4" />
                                Clear selection
                            </Button>
                        </div>
                    </div>
                );
            }}
        />
    );
}
