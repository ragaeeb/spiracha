import type { CommandCodeSessionSummary } from '@spiracha/lib/command-code-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
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
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type CommandCodeSessionsTableProps = {
    onDeleteSession: (session: CommandCodeSessionSummary) => void;
    onDeleteSessions: (sessionIds: string[]) => void;
    onExportSession: (session: CommandCodeSessionSummary) => void;
    onExportSessions: (sessionIds: string[]) => void;
    sessions: CommandCodeSessionSummary[];
};

const columnHelper = createDataTableColumnHelper<CommandCodeSessionSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'updated' }];

const buildColumns = (
    onDeleteSession: (session: CommandCodeSessionSummary) => void,
    onExportSession: (session: CommandCodeSessionSummary) => void,
) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ sessionId: info.row.original.sessionId }}
                    to="/command-code-sessions/$sessionId"
                >
                    <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                    <p className="truncate text-[var(--muted-foreground)] text-xs">{info.row.original.sessionId}</p>
                </Link>
            ),
            header: 'Session',
        }),
        columnHelper.accessor('lastActiveAtMs', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Updated',
            id: 'updated',
        }),
        columnHelper.accessor('modelLabel', {
            cell: (info) => <span className="text-sm">{info.getValue() ?? 'unknown'}</span>,
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
                            disabled={info.row.original.renderableMessageCount === 0}
                            onClick={() => onExportSession(info.row.original)}
                        >
                            <Download className="mr-2 size-4" />
                            Export session
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-[var(--destructive)] focus:text-[var(--destructive)]"
                            onClick={() => onDeleteSession(info.row.original)}
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

export function CommandCodeSessionsTable({
    onDeleteSession,
    onDeleteSessions,
    onExportSession,
    onExportSessions,
    sessions,
}: CommandCodeSessionsTableProps) {
    const columns = useMemo(() => buildColumns(onDeleteSession, onExportSession), [onDeleteSession, onExportSession]);

    return (
        <DataTable
            columns={columns}
            data={sessions}
            emptyMessage="No Command Code sessions match the current workspace filter."
            enableRowSelection
            getRowId={(row) => row.sessionId}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => (
                <SelectionActionsToolbar
                    clearSelection={clearSelection}
                    exportDisabled={selectedRows.some((row) => row.renderableMessageCount === 0)}
                    itemLabel="session"
                    selectedCount={selectedRows.length}
                    onDeleteSelected={() => onDeleteSessions(selectedRows.map((row) => row.sessionId))}
                    onExportSelected={() => onExportSessions(selectedRows.map((row) => row.sessionId))}
                />
            )}
        />
    );
}
