import type { CursorThreadSummary } from '@spiracha/lib/cursor-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { ConversationTitleCell } from '#/components/conversation-title-cell';
import { DataTable } from '#/components/data-table';
import { ConversationSelectionActions } from '#/components/selection-actions-toolbar';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { supportedListAction } from '#/lib/conversation-actions';
import type { ConversationListInventoryProps } from '#/lib/conversation-selection';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatBytes, formatDateTime, formatModelLabel, formatNumber } from '#/lib/formatters';

type CursorThreadsTableProps = {
    onDeleteThread: (thread: CursorThreadSummary) => void;
    onDeleteThreads: (composerIds: string[]) => void;
    onExportThread: (thread: CursorThreadSummary) => void;
    onExportThreads: (composerIds: string[]) => void;
    threads: CursorThreadSummary[];
} & ConversationListInventoryProps<CursorThreadSummary>;

type CursorThreadTreeNode = CursorThreadSummary & { children: CursorThreadTreeNode[] };

const columnHelper = createDataTableColumnHelper<CursorThreadTreeNode>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];

const CursorThreadTitleCell = ({ depth, thread }: { depth: number; thread: CursorThreadTreeNode }) => (
    <ConversationTitleCell
        depth={depth}
        footer={
            thread.snapshotCount > 1 ? (
                thread.latestSnapshotComposerId && thread.latestSnapshotComposerId !== thread.composerId ? (
                    <Link
                        className="block truncate text-[var(--accent)] text-xs hover:underline"
                        params={{ composerId: thread.latestSnapshotComposerId }}
                        to="/cursor-threads/$composerId"
                    >
                        Older moved snapshot · open latest
                    </Link>
                ) : (
                    <p className="truncate text-[var(--muted-foreground)] text-xs">
                        Latest moved snapshot · {formatNumber(thread.snapshotCount)} physical records
                    </p>
                )
            ) : null
        }
        id={thread.composerId}
        isNestedAgent={depth > 0}
        renderLink={(content, className) => (
            <Link className={className} params={{ composerId: thread.composerId }} to="/cursor-threads/$composerId">
                {content}
            </Link>
        )}
        title={thread.name}
    />
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
            header: 'Stored bubbles',
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
    authoritativeRowIds,
    authoritativeRows,
    inventoryIdentity,
    onDeleteThread,
    onDeleteThreads,
    onExportThread,
    onExportThreads,
    threads,
}: CursorThreadsTableProps) => {
    const tableColumns = useMemo(() => columns(onDeleteThread, onExportThread), [onDeleteThread, onExportThread]);
    const threadTreeRoots = useMemo(() => getCursorThreadTreeRoots(threads), [threads]);
    const inventoryTree = useMemo(
        () => getCursorThreadTreeRoots(authoritativeRows ?? threads),
        [authoritativeRows, threads],
    );

    return (
        <DataTable
            authoritativeRowIds={authoritativeRowIds}
            authoritativeRows={inventoryTree}
            columns={tableColumns}
            data={threadTreeRoots}
            emptyMessage="No Cursor threads match the current workspace filter."
            enableRowSelection
            expandAllRows
            getRowId={(row) => row.composerId}
            getSubRows={(row) => row.children}
            initialSorting={defaultSorting}
            inventoryIdentity={inventoryIdentity}
            renderToolbar={({ clearSelection, hiddenSelectedCount, selectedIds, selectedRows }) => (
                <ConversationSelectionActions
                    clearSelection={clearSelection}
                    deleteAction={supportedListAction(() => onDeleteThreads(selectedIds))}
                    exportAction={supportedListAction(() => onExportThreads(selectedIds), {
                        disabled: selectedRows.some((row) => row.bubbleCount === 0),
                    })}
                    hiddenSelectedCount={hiddenSelectedCount}
                    itemLabel="thread"
                    selectedCount={selectedIds.length}
                />
            )}
        />
    );
};
