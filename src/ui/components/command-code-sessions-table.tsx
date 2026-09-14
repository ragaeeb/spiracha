import type { CommandCodeSessionSummary } from '@spiracha/lib/command-code-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { DataTable } from '#/components/data-table';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type CommandCodeSessionsTableProps = {
    sessions: CommandCodeSessionSummary[];
};

const columnHelper = createDataTableColumnHelper<CommandCodeSessionSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'updated' }];

const columns = [
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
] as const;

export function CommandCodeSessionsTable({ sessions }: CommandCodeSessionsTableProps) {
    return (
        <DataTable
            columns={columns}
            data={sessions}
            emptyMessage="No Command Code sessions match the current workspace filter."
            getRowId={(row) => row.sessionId}
            initialSorting={defaultSorting}
        />
    );
}
