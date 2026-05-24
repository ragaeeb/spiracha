import type { ThreadListEntry } from '@spiracha/lib/codex-browser-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, MoreHorizontal, Trash2, X } from 'lucide-react';
import { DataTable } from '#/components/data-table';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { formatBytes, formatDateTime, formatNumber, formatTokens } from '#/lib/formatters';

type ThreadsTableProps = {
    threads: ThreadListEntry[];
    onDeleteThread: (thread: ThreadListEntry) => void;
    onDeleteThreads: (threadIds: string[]) => void;
    onExportThread: (thread: ThreadListEntry) => void;
    onExportThreads: (threadIds: string[]) => void;
};

const columnHelper = createColumnHelper<ThreadListEntry>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];

const columns = (
    onDeleteThread: (thread: ThreadListEntry) => void,
    onExportThread: (thread: ThreadListEntry) => void,
) =>
    [
        columnHelper.accessor((row) => row.thread.title, {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[20rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ threadId: info.row.original.thread.id }}
                    to="/threads/$threadId"
                >
                    <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                    <p className="line-clamp-2 text-[var(--muted-foreground)] text-xs">
                        {info.row.original.thread.preview}
                    </p>
                </Link>
            ),
            header: 'Thread',
            id: 'title',
        }),
        columnHelper.accessor((row) => row.thread.updated_at_ms ?? row.thread.updated_at * 1000, {
            cell: (info) => <span className="whitespace-nowrap text-sm">{formatDateTime(info.getValue())}</span>,
            header: 'Updated',
            id: 'updatedAt',
        }),
        columnHelper.accessor((row) => row.thread.created_at_ms ?? row.thread.created_at * 1000, {
            cell: (info) => <span className="whitespace-nowrap text-sm">{formatDateTime(info.getValue())}</span>,
            header: 'Created',
            id: 'createdAt',
        }),
        columnHelper.accessor((row) => row.thread.model ?? 'unknown', {
            cell: (info) => <span className="truncate font-mono text-sm">{info.getValue()}</span>,
            header: 'Model',
            id: 'model',
        }),
        columnHelper.accessor((row) => row.thread.tokens_used, {
            cell: (info) => (
                <span className="whitespace-nowrap font-mono text-sm">{formatTokens(info.getValue())}</span>
            ),
            header: 'Tokens',
            id: 'tokens',
        }),
        columnHelper.accessor((row) => row.rolloutSizeBytes, {
            cell: (info) => (
                <span className="whitespace-nowrap font-mono text-sm">{formatBytes(info.getValue() ?? 0)}</span>
            ),
            header: 'Size',
            id: 'size',
        }),
        columnHelper.accessor((row) => row.stats.toolCallCount, {
            cell: (info) =>
                info.row.original.stats.deferred ? (
                    <span className="text-[var(--muted-foreground)] text-sm">Deferred</span>
                ) : (
                    <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>
                ),
            header: 'Tools',
            id: 'tools',
        }),
        columnHelper.accessor((row) => row.thread.archived, {
            cell: (info) => <span className="text-sm">{info.getValue() ? 'Archived' : 'Active'}</span>,
            header: 'State',
            id: 'state',
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
                        <DropdownMenuItem onClick={() => onExportThread(info.row.original)}>
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

export function ThreadsTable({
    threads,
    onDeleteThread,
    onDeleteThreads,
    onExportThread,
    onExportThreads,
}: ThreadsTableProps) {
    return (
        <DataTable
            columns={columns(onDeleteThread, onExportThread)}
            data={threads}
            emptyMessage="No threads match the current project filter."
            enableRowSelection
            getRowId={(row) => row.thread.id}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => {
                if (selectedRows.length === 0) {
                    return (
                        <p className="text-[var(--muted-foreground)] text-sm">
                            Select threads to export or delete them in a batch.
                        </p>
                    );
                }

                const selectedThreadIds = selectedRows.map((row) => row.thread.id);
                return (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm">
                            {selectedRows.length} thread{selectedRows.length === 1 ? '' : 's'} selected
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                className="rounded-full"
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => onExportThreads(selectedThreadIds)}
                            >
                                <Download className="mr-2 size-4" />
                                Export selected threads
                            </Button>
                            <Button
                                className="rounded-full border-[var(--destructive)]/20 text-[var(--destructive)]"
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => onDeleteThreads(selectedThreadIds)}
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
