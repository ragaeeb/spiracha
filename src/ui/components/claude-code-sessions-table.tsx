import type { ClaudeCodeSessionSummary } from '@spiracha/lib/claude-code-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
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
import type { ConversationListInventoryProps } from '#/lib/conversation-selection';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatModelLabel, formatNumber, formatTokens } from '#/lib/formatters';

type ClaudeCodeSessionsTableProps = {
    onDeleteSession: (session: ClaudeCodeSessionSummary) => void;
    onDeleteSessions: (sessionIds: string[]) => void;
    onExportSession: (session: ClaudeCodeSessionSummary) => void;
    onExportSessions: (sessionIds: string[]) => void;
    sessions: ClaudeCodeSessionSummary[];
} & ConversationListInventoryProps<ClaudeCodeSessionSummary>;

type ClaudeCodeSessionTreeNode = ClaudeCodeSessionSummary & {
    branchCount: number;
    children: ClaudeCodeSessionTreeNode[];
    isEarlierBranch: boolean;
};

const columnHelper = createDataTableColumnHelper<ClaudeCodeSessionTreeNode>();
const defaultSorting: SortingState = [{ desc: true, id: 'lastActive' }];

const SessionTitleCell = ({ depth, session }: { depth: number; session: ClaudeCodeSessionTreeNode }) => (
    <ConversationTitleCell
        badges={
            <>
                {session.branchCount > 1 ? <Badge variant="outline">{session.branchCount} branches</Badge> : null}
                {session.isEarlierBranch ? <Badge variant="outline">Earlier branch</Badge> : null}
            </>
        }
        depth={depth}
        id={session.sessionId}
        isNestedAgent={session.hierarchy?.parentSessionId != null}
        renderLink={(content, className) => (
            <Link className={className} params={{ sessionId: session.sessionId }} to="/claude-code-sessions/$sessionId">
                {content}
            </Link>
        )}
        title={session.title}
    />
);

// Rewinding a conversation writes a new session file; nest earlier branches under the newest one.
const getLatestBranchIds = (sessions: ClaudeCodeSessionSummary[]): Map<string, string> => {
    const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
    const getFamilyRootId = (session: ClaudeCodeSessionSummary): string => {
        const seen = new Set<string>();
        let current = session;
        while (current.forkedFrom && !seen.has(current.sessionId)) {
            seen.add(current.sessionId);
            const parent = sessionsById.get(current.forkedFrom.sessionId);
            if (!parent) {
                break;
            }
            current = parent;
        }
        return current.sessionId;
    };

    const latestByFamily = new Map<string, ClaudeCodeSessionSummary>();
    const familyBySession = new Map<string, string>();
    for (const session of sessions) {
        const familyId = getFamilyRootId(session);
        familyBySession.set(session.sessionId, familyId);
        const latest = latestByFamily.get(familyId);
        if (!latest || (session.lastActiveAtMs ?? 0) > (latest.lastActiveAtMs ?? 0)) {
            latestByFamily.set(familyId, session);
        }
    }

    return new Map(
        sessions.map((session) => [
            session.sessionId,
            latestByFamily.get(familyBySession.get(session.sessionId) ?? '')?.sessionId ?? session.sessionId,
        ]),
    );
};

const getSessionTreeRoots = (sessions: ClaudeCodeSessionSummary[]): ClaudeCodeSessionTreeNode[] => {
    const latestBranchIds = getLatestBranchIds(sessions);
    const branchCounts = new Map<string, number>();
    for (const latestId of latestBranchIds.values()) {
        branchCounts.set(latestId, (branchCounts.get(latestId) ?? 0) + 1);
    }
    const nodesById = new Map<string, ClaudeCodeSessionTreeNode>(
        sessions.map((session) => [
            session.sessionId,
            {
                ...session,
                branchCount: branchCounts.get(session.sessionId) ?? 0,
                children: [],
                isEarlierBranch: latestBranchIds.get(session.sessionId) !== session.sessionId,
            },
        ]),
    );
    const childIdsByParentId = new Map<string, string[]>();
    const rootIds: string[] = [];

    for (const session of sessions) {
        const sessionId = session.sessionId;
        const latestBranchId = latestBranchIds.get(sessionId) ?? sessionId;
        const parentSessionId =
            session.hierarchy?.parentSessionId ?? (latestBranchId === sessionId ? null : latestBranchId);
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

const withoutChildren = ({
    branchCount: _branchCount,
    children: _children,
    isEarlierBranch: _isEarlierBranch,
    ...session
}: ClaudeCodeSessionTreeNode): ClaudeCodeSessionSummary => session;

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
    authoritativeRowIds,
    authoritativeRows,
    inventoryIdentity,
    onDeleteSession,
    onDeleteSessions,
    onExportSession,
    onExportSessions,
    sessions,
}: ClaudeCodeSessionsTableProps) {
    const tableColumns = useMemo(() => columns(onDeleteSession, onExportSession), [onDeleteSession, onExportSession]);
    const sessionTreeRoots = useMemo(() => getSessionTreeRoots(sessions), [sessions]);
    const inventoryTree = useMemo(
        () => getSessionTreeRoots(authoritativeRows ?? sessions),
        [authoritativeRows, sessions],
    );

    return (
        <DataTable
            authoritativeRowIds={authoritativeRowIds}
            authoritativeRows={inventoryTree}
            columns={tableColumns}
            data={sessionTreeRoots}
            emptyMessage="No Claude Code sessions match the current workspace filter."
            enableRowSelection
            expandAllRows
            getRowId={(row) => row.sessionId}
            getSubRows={(row) => row.children}
            initialSorting={defaultSorting}
            inventoryIdentity={inventoryIdentity}
            renderToolbar={({ clearSelection, hiddenSelectedCount, selectedIds, selectedRows }) => (
                <ConversationSelectionActions
                    clearSelection={clearSelection}
                    deleteAction={supportedListAction(() => onDeleteSessions(selectedIds))}
                    exportAction={supportedListAction(() => onExportSessions(selectedIds), {
                        disabled: selectedRows.some((row) => row.renderablePartCount === 0),
                    })}
                    hiddenSelectedCount={hiddenSelectedCount}
                    itemLabel="session"
                    selectedCount={selectedIds.length}
                />
            )}
        />
    );
}
