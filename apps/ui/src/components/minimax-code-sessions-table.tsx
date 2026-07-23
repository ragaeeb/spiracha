import type { MiniMaxCodeSessionSummary } from '@spiracha/lib/minimax-code-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
import { Download } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { SelectionActionsToolbar } from '#/components/selection-actions-toolbar';
import { Button } from '#/components/ui/button';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type MiniMaxCodeSessionsTableProps = {
    onExportSession: (session: MiniMaxCodeSessionSummary) => void;
    onExportSessions: (sessionIds: string[]) => void;
    sessions: MiniMaxCodeSessionSummary[];
};

const columnHelper = createColumnHelper<MiniMaxCodeSessionSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'lastActive' }];

const buildColumns = (onExportSession: (session: MiniMaxCodeSessionSummary) => void) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ sessionId: info.row.original.sessionId }}
                    to="/minimax-code-sessions/$sessionId"
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
            id: 'lastActive',
        }),
        columnHelper.accessor('agentName', {
            cell: (info) => <span className="font-mono text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Agent',
        }),
        columnHelper.accessor('currentModelId', {
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
                <Button
                    aria-label={`Export ${info.row.original.title}`}
                    className="rounded-full"
                    disabled={info.row.original.renderablePartCount === 0}
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={() => onExportSession(info.row.original)}
                >
                    <Download className="size-4" />
                </Button>
            ),
            enableSorting: false,
            header: '',
            id: 'actions',
        }),
    ] as const;

export const MiniMaxCodeSessionsTable = ({
    onExportSession,
    onExportSessions,
    sessions,
}: MiniMaxCodeSessionsTableProps) => {
    const columns = useMemo(() => buildColumns(onExportSession), [onExportSession]);
    return (
        <DataTable
            columns={columns}
            data={sessions}
            emptyMessage="No MiniMax Code sessions match the current workspace filter."
            enableRowSelection
            getRowId={(row) => row.sessionId}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => (
                <SelectionActionsToolbar
                    clearSelection={clearSelection}
                    exportDisabled={selectedRows.some((row) => row.renderablePartCount === 0)}
                    itemLabel="session"
                    selectedCount={selectedRows.length}
                    onExportSelected={() => onExportSessions(selectedRows.map((row) => row.sessionId))}
                />
            )}
        />
    );
};
