import type { ClaudeCodeSessionSummary } from '@spiracha/lib/claude-code-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
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
import { formatDateTime, formatModelLabel, formatNumber, formatTokens } from '#/lib/formatters';
import { cn } from '#/lib/utils';

type ClaudeCodeSessionsTableProps = {
    onDeleteSession: (session: ClaudeCodeSessionSummary) => void;
    onDeleteSessions: (sessionIds: string[]) => void;
    onExportSession: (session: ClaudeCodeSessionSummary) => void;
    onExportSessions: (sessionIds: string[]) => void;
    sessions: ClaudeCodeSessionSummary[];
};

type ClaudeCodeSessionTreeNode = ClaudeCodeSessionSummary & {
    children: ClaudeCodeSessionTreeNode[];
};

const columnHelper = createColumnHelper<ClaudeCodeSessionTreeNode>();
const defaultSorting: SortingState = [{ desc: true, id: 'lastActive' }];

const SessionTitleCell = ({ depth, session }: { depth: number; session: ClaudeCodeSessionTreeNode }) => {
    const isSubagent = depth > 0;

    return (
        <div
            className={cn('min-w-0', isSubagent ? 'border-[var(--border)] border-l-2 pl-3' : '')}
            data-row-depth={depth}
        >
            <div className="flex min-w-0 items-center gap-2">
                {isSubagent ? (
                    <GitFork aria-hidden="true" className="size-4 shrink-0 text-[var(--muted-foreground)]" />
                ) : null}
                <Link
                    className="block min-w-0 flex-1 space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    params={{ sessionId: session.sessionId }}
                    to="/claude-code-sessions/$sessionId"
                >
                    <p className="truncate font-medium underline-offset-2 hover:underline">{session.title}</p>
                    <p className="truncate text-[var(--muted-foreground)] text-xs">{session.sessionId}</p>
                </Link>
            </div>
        </div>
    );
};

const getSessionTreeRoots = (sessions: ClaudeCodeSessionSummary[]): ClaudeCodeSessionTreeNode[] => {
    const nodesById = new Map(sessions.map((session) => [session.sessionId, { ...session, children: [] }]));
    const childIdsByParentId = new Map<string, string[]>();
    const rootIds: string[] = [];

    for (const session of sessions) {
        const sessionId = session.sessionId;
        const parentSessionId = session.hierarchy?.parentSessionId ?? null;
        if (!parentSessionId || parentSessionId === sessionId || !nodesById.has(parentSessionId)) {
            rootIds.push(sessionId);
            continue;
        }

        const childIds = childIdsByParentId.get(parentSessionId) ?? [];
        childIds.push(sessionId);
        childIdsByParentId.set(parentSessionId, childIds);
    }

    const roots: ClaudeCodeSessionTreeNode[] = [];
    const attachedSessionIds = new Set<string>();
    const attachNode = (sessionId: string, parent: ClaudeCodeSessionTreeNode | null) => {
        if (attachedSessionIds.has(sessionId)) {
            return;
        }

        const node = nodesById.get(sessionId);
        if (!node) {
            return;
        }

        attachedSessionIds.add(sessionId);
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }

        for (const childSessionId of childIdsByParentId.get(sessionId) ?? []) {
            attachNode(childSessionId, node);
        }
    };

    for (const sessionId of rootIds) {
        attachNode(sessionId, null);
    }
    for (const session of sessions) {
        attachNode(session.sessionId, null);
    }

    return roots;
};

const withoutChildren = ({ children: _children, ...session }: ClaudeCodeSessionTreeNode): ClaudeCodeSessionSummary =>
    session;

const columns = (
    onDeleteSession: (session: ClaudeCodeSessionSummary) => void,
    onExportSession: (session: ClaudeCodeSessionSummary) => void,
) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => <SessionTitleCell depth={info.row.depth} session={info.row.original} />,
            header: 'Session',
        }),
        columnHelper.accessor('lastActiveAtMs', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Updated',
            id: 'lastActive',
        }),
        columnHelper.accessor('model', {
            cell: (info) => (
                <span className="text-sm">{info.getValue() ? formatModelLabel(info.getValue()) : 'unknown'}</span>
            ),
            header: 'Model',
        }),
        columnHelper.accessor('messageCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Messages',
        }),
        columnHelper.accessor('toolCallCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Tools',
        }),
        columnHelper.accessor('totalTokens', {
            cell: (info) => (
                <span className="whitespace-nowrap font-mono text-sm">{formatTokens(info.getValue())}</span>
            ),
            header: 'Tokens',
        }),
        columnHelper.accessor('version', {
            cell: (info) => <span className="font-mono text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Version',
        }),
        columnHelper.display({
            cell: (info) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            aria-label={`Actions for ${info.row.original.title}`}
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
                            disabled={info.row.original.renderablePartCount === 0}
                            onClick={() => onExportSession(withoutChildren(info.row.original))}
                        >
                            <Download className="mr-2 size-4" />
                            Export session
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-[var(--destructive)]"
                            onClick={() => onDeleteSession(withoutChildren(info.row.original))}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete session
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
            enableSorting: false,
            header: '',
            id: 'actions',
        }),
    ] as const;

export function ClaudeCodeSessionsTable({
    onDeleteSession,
    onDeleteSessions,
    onExportSession,
    onExportSessions,
    sessions,
}: ClaudeCodeSessionsTableProps) {
    const tableColumns = useMemo(() => columns(onDeleteSession, onExportSession), [onDeleteSession, onExportSession]);
    const sessionTreeRoots = useMemo(() => getSessionTreeRoots(sessions), [sessions]);

    return (
        <DataTable
            columns={tableColumns}
            data={sessionTreeRoots}
            emptyMessage="No Claude Code sessions match the current workspace filter."
            enableRowSelection
            expandAllRows
            getRowId={(row) => row.sessionId}
            getSubRows={(row) => row.children}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => {
                const selectedSessionIds = selectedRows.map((row) => row.sessionId);
                const hasEmptySelection = selectedRows.some((row) => row.renderablePartCount === 0);
                return (
                    <SelectionActionsToolbar
                        clearSelection={clearSelection}
                        exportDisabled={hasEmptySelection}
                        itemLabel="session"
                        selectedCount={selectedRows.length}
                        onDeleteSelected={() => onDeleteSessions(selectedSessionIds)}
                        onExportSelected={() => onExportSessions(selectedSessionIds)}
                    />
                );
            }}
        />
    );
}
