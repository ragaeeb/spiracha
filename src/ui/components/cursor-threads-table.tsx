import type { CursorThreadSummary } from '@spiracha/lib/cursor-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { Download, GitFork, MoreHorizontal, Trash2 } from 'lucide-react';
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
import { formatBytes, formatDateTime, formatModelLabel, formatNumber } from '#/lib/formatters';
import { cn } from '#/lib/utils';

type CursorThreadsTableProps = {
    onDeleteThread: (thread: CursorThreadSummary) => void;
    onDeleteThreads: (composerIds: string[]) => void;
    onExportThread: (thread: CursorThreadSummary) => void;
    onExportThreads: (composerIds: string[]) => void;
    threads: CursorThreadSummary[];
};

type CursorThreadTreeNode = CursorThreadSummary & { children: CursorThreadTreeNode[] };

const columnHelper = createDataTableColumnHelper<CursorThreadTreeNode>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];

const CursorThreadTitleCell = ({ depth, thread }: { depth: number; thread: CursorThreadTreeNode }) => (
    <div className={cn('min-w-0', depth > 0 ? 'border-[var(--border)] border-l-2 pl-3' : '')} data-row-depth={depth}>
        <div className="flex min-w-0 items-center gap-2">
            {depth > 0 ? (
                <GitFork aria-hidden="true" className="size-4 shrink-0 text-[var(--muted-foreground)]" />
            ) : null}
            <Link
                className="block min-w-0 flex-1 space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                params={{ composerId: thread.composerId }}
                to="/cursor-threads/$composerId"
            >
                <p className="truncate font-medium underline-offset-2 hover:underline">{thread.name}</p>
                <p className="truncate text-[var(--muted-foreground)] text-xs">
                    {thread.mode ? `${thread.mode} · ` : ''}
                    {thread.composerId}
                </p>
            </Link>
        </div>
    </div>
);

const getCursorThreadTreeRoots = (threads: CursorThreadSummary[]): CursorThreadTreeNode[] => {
    const nodesById = new Map<string, CursorThreadTreeNode>(
        threads.map((thread) => [thread.composerId, { ...thread, children: [] as CursorThreadTreeNode[] }]),
    );
    const roots: CursorThreadTreeNode[] = [];
    for (const thread of threads) {
        const node = nodesById.get(thread.composerId)!;
        const parent = thread.parentComposerId ? nodesById.get(thread.parentComposerId) : null;
        if (parent && parent !== node) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }
    return roots;
};

const withoutChildren = ({ children: _children, ...thread }: CursorThreadTreeNode): CursorThreadSummary => thread;

const columns = (
    onDeleteThread: (thread: CursorThreadSummary) => void,
    onExportThread: (thread: CursorThreadSummary) => void,
) =>
    [
        columnHelper.accessor('name', {
            cell: (info) => <CursorThreadTitleCell depth={info.row.depth} thread={info.row.original} />,
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
        columnHelper.accessor('model', {
            cell: (info) => (
                <div className="space-y-1 text-sm">
                    <div>{info.getValue() ? formatModelLabel(info.getValue()) : 'unknown'}</div>
                    {info.row.original.reasoningEffort ? (
                        <div className="text-[var(--muted-foreground)] text-xs">
                            {info.row.original.reasoningEffort} reasoning
                        </div>
                    ) : null}
                </div>
            ),
            header: 'Model',
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
                            onClick={() => onExportThread(withoutChildren(info.row.original))}
                        >
                            <Download className="mr-2 size-4" />
                            Export thread
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-[var(--destructive)]"
                            onClick={() => onDeleteThread(withoutChildren(info.row.original))}
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
    const threadTreeRoots = useMemo(() => getCursorThreadTreeRoots(threads), [threads]);

    return (
        <DataTable
            columns={tableColumns}
            data={threadTreeRoots}
            emptyMessage="No Cursor threads match the current workspace filter."
            enableRowSelection
            expandAllRows
            getRowId={(row) => row.composerId}
            getSubRows={(row) => row.children}
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
