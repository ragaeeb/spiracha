import type { ThreadListEntry } from '@spiracha/lib/codex-browser-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { Download, GitBranch, MoreHorizontal, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { ConversationTitleCell } from '#/components/conversation-title-cell';
import { DataTable } from '#/components/data-table';
import { ConversationSelectionActions } from '#/components/selection-actions-toolbar';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { supportedListAction } from '#/lib/conversation-actions';
import type { ConversationListSelectionProps } from '#/lib/conversation-selection';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatBytes, formatDateTime, formatTokens } from '#/lib/formatters';

type ThreadsTableProps = {
    threads: ThreadListEntry[];
    onDeleteThread: (thread: ThreadListEntry) => void;
    onDeleteThreads: (threadIds: string[]) => void;
    onExportThread: (thread: ThreadListEntry) => void;
    onExportThreads: (threadIds: string[]) => void;
} & ConversationListSelectionProps;

type ThreadTreeNode = ThreadListEntry & {
    children: ThreadTreeNode[];
    forkParentTitle?: string;
};

const columnHelper = createDataTableColumnHelper<ThreadTreeNode>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];
const CODEX_PROJECT_THREADS_PAGE_SIZE = 100;

const ForkBadge = ({ thread }: { thread: ThreadTreeNode }) => {
    const fork = thread.fork;
    if (!fork) {
        return null;
    }

    const parentId = fork.parentThreadId;
    return (
        <Badge
            title={
                fork.parentAvailable
                    ? thread.forkParentTitle
                        ? `Forked from ${thread.forkParentTitle} (${parentId})`
                        : `Forked from thread ${parentId}`
                    : `Forked from thread ${parentId}, which no longer exists. Only the conversation after the fork is available.`
            }
            variant="outline"
        >
            <GitBranch aria-hidden="true" />
            {fork.parentAvailable ? 'Fork' : 'Fork · parent deleted'}
        </Badge>
    );
};

const ThreadTitleCell = ({ depth, thread }: { depth: number; thread: ThreadTreeNode }) => (
    <ConversationTitleCell
        badges={<ForkBadge thread={thread} />}
        depth={depth}
        id={thread.thread.id}
        isNestedAgent={depth > 0 && thread.hierarchy.parentThreadId !== null}
        renderLink={(content, className) => (
            <Link className={className} params={{ threadId: thread.thread.id }} to="/threads/$threadId">
                {content}
            </Link>
        )}
        title={thread.thread.title}
    />
);

const getThreadTreeRoots = (threads: ThreadListEntry[]): ThreadTreeNode[] => {
    const nodesById = new Map<string, ThreadTreeNode>(
        threads.map((thread) => [thread.thread.id, { ...thread, children: [] }]),
    );
    for (const node of nodesById.values()) {
        if (node.fork) {
            node.forkParentTitle = nodesById.get(node.fork.parentThreadId)?.thread.title;
        }
    }
    const childIdsByParentId = new Map<string, string[]>();
    const rootIds: string[] = [];

    for (const thread of threads) {
        const threadId = thread.thread.id;
        // Subagents nest under the thread that spawned them; forks nest under the thread they were forked from.
        const parentThreadId = thread.hierarchy.parentThreadId ?? thread.fork?.parentThreadId ?? null;
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
    authoritativeRowIds,
    inventoryIdentity,
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
            authoritativeRowIds={authoritativeRowIds}
            columns={memoizedColumns}
            data={threadTreeRoots}
            emptyMessage="No threads match the current project filter."
            enableRowSelection
            expandAllRows
            getRowId={(row) => row.thread.id}
            getSubRows={(row) => row.children}
            initialSorting={defaultSorting}
            inventoryIdentity={inventoryIdentity}
            pageSize={CODEX_PROJECT_THREADS_PAGE_SIZE}
            renderToolbar={({ clearSelection, hiddenSelectedCount, selectedIds }) => (
                <ConversationSelectionActions
                    clearSelection={clearSelection}
                    deleteAction={supportedListAction(() => onDeleteThreads(selectedIds))}
                    exportAction={supportedListAction(() => onExportThreads(selectedIds))}
                    hiddenSelectedCount={hiddenSelectedCount}
                    itemLabel="thread"
                    selectedCount={selectedIds.length}
                />
            )}
        />
    );
}
