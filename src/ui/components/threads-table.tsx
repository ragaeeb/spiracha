import type { ThreadListEntry } from '@spiracha/lib/codex-browser-types';
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
import { formatBytes, formatDateTime, formatTokens } from '#/lib/formatters';
import { cn } from '#/lib/utils';

type ThreadsTableProps = {
    threads: ThreadListEntry[];
    onDeleteThread: (thread: ThreadListEntry) => void;
    onDeleteThreads: (threadIds: string[]) => void;
    onExportThread: (thread: ThreadListEntry) => void;
    onExportThreads: (threadIds: string[]) => void;
};

type ThreadTreeNode = ThreadListEntry & {
    children: ThreadTreeNode[];
};

const columnHelper = createDataTableColumnHelper<ThreadTreeNode>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];
const CODEX_PROJECT_THREADS_PAGE_SIZE = 100;

const ThreadTitleCell = ({ depth, thread }: { depth: number; thread: ThreadTreeNode }) => {
    const isSubagent = depth > 0;

    return (
        <div className={cn('min-w-0', isSubagent ? 'border-[var(--border)] border-l-2 pl-3' : '')}>
            <div className="flex min-w-0 items-center gap-2">
                {isSubagent ? (
                    <GitFork aria-hidden="true" className="size-4 shrink-0 text-[var(--muted-foreground)]" />
                ) : null}
                <Link
                    className="min-w-0 flex-1 truncate rounded-md font-medium outline-none transition hover:underline hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    params={{ threadId: thread.thread.id }}
                    to="/threads/$threadId"
                >
                    {thread.thread.title}
                </Link>
            </div>
        </div>
    );
};

const getThreadTreeRoots = (threads: ThreadListEntry[]): ThreadTreeNode[] => {
    const nodesById = new Map(threads.map((thread) => [thread.thread.id, { ...thread, children: [] }]));
    const childIdsByParentId = new Map<string, string[]>();
    const rootIds: string[] = [];

    for (const thread of threads) {
        const threadId = thread.thread.id;
        const parentThreadId = thread.hierarchy.parentThreadId;
        if (!parentThreadId || parentThreadId === threadId || !nodesById.has(parentThreadId)) {
            rootIds.push(threadId);
            continue;
        }

        const childIds = childIdsByParentId.get(parentThreadId) ?? [];
        childIds.push(threadId);
        childIdsByParentId.set(parentThreadId, childIds);
    }

    const roots: ThreadTreeNode[] = [];
    const attachedThreadIds = new Set<string>();
    const attachNode = (threadId: string, parent: ThreadTreeNode | null) => {
        if (attachedThreadIds.has(threadId)) {
            return;
        }

        const node = nodesById.get(threadId);
        if (!node) {
            return;
        }

        attachedThreadIds.add(threadId);
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }

        for (const childThreadId of childIdsByParentId.get(threadId) ?? []) {
            attachNode(childThreadId, node);
        }
    };

    for (const threadId of rootIds) {
        attachNode(threadId, null);
    }
    for (const thread of threads) {
        attachNode(thread.thread.id, null);
    }

    return roots;
};

const withoutChildren = ({ children: _children, ...thread }: ThreadTreeNode): ThreadListEntry => thread;

const columns = (
    onDeleteThread: (thread: ThreadListEntry) => void,
    onExportThread: (thread: ThreadListEntry) => void,
) =>
    [
        columnHelper.accessor((row) => row.thread.title, {
            cell: (info) => <ThreadTitleCell depth={info.row.depth} thread={info.row.original} />,
            header: 'Thread',
            id: 'title',
        }),
        columnHelper.accessor((row) => row.thread.updated_at_ms ?? row.thread.updated_at * 1000, {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Updated',
            id: 'updatedAt',
        }),
        columnHelper.accessor((row) => row.thread.created_at_ms ?? row.thread.created_at * 1000, {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Created',
            id: 'createdAt',
        }),
        columnHelper.accessor((row) => row.modelNames.join(', ') || row.thread.model || 'unknown', {
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
                            aria-label={`Actions for ${info.row.original.thread.title}`}
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
                        <DropdownMenuItem onClick={() => onExportThread(withoutChildren(info.row.original))}>
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

export function ThreadsTable({
    threads,
    onDeleteThread,
    onDeleteThreads,
    onExportThread,
    onExportThreads,
}: ThreadsTableProps) {
    const threadTreeRoots = useMemo(() => getThreadTreeRoots(threads), [threads]);
    const memoizedColumns = useMemo(() => columns(onDeleteThread, onExportThread), [onDeleteThread, onExportThread]);
    return (
        <DataTable
            columns={memoizedColumns}
            data={threadTreeRoots}
            emptyMessage="No threads match the current project filter."
            enableRowSelection
            expandAllRows
            getRowId={(row) => row.thread.id}
            getSubRows={(row) => row.children}
            initialSorting={defaultSorting}
            pageSize={CODEX_PROJECT_THREADS_PAGE_SIZE}
            renderToolbar={({ clearSelection, selectedRows }) => {
                const selectedThreadIds = selectedRows.map((row) => row.thread.id);
                return (
                    <SelectionActionsToolbar
                        clearSelection={clearSelection}
                        itemLabel="thread"
                        selectedCount={selectedRows.length}
                        onDeleteSelected={() => onDeleteThreads(selectedThreadIds)}
                        onExportSelected={() => onExportThreads(selectedThreadIds)}
                    />
                );
            }}
        />
    );
}
