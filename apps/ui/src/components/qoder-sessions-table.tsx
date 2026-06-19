import type { QoderSessionSummary } from '@spiracha/lib/qoder-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, MoreHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type QoderSessionsTableProps = {
    onExportSession: (session: QoderSessionSummary) => void;
    sessions: QoderSessionSummary[];
};

const columnHelper = createColumnHelper<QoderSessionSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'lastActive' }];

const columns = (onExportSession: (session: QoderSessionSummary) => void) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ sessionId: info.row.original.sessionId }}
                    to="/qoder-sessions/$sessionId"
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
        columnHelper.accessor('status', {
            cell: (info) => <span className="font-mono text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Status',
        }),
        columnHelper.accessor('model', {
            cell: (info) => <span className="font-mono text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Model',
        }),
        columnHelper.accessor('messageCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Prompts',
        }),
        columnHelper.accessor('fileOperationCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'File ops',
        }),
        columnHelper.accessor('snapshotFileCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Snapshots',
        }),
        columnHelper.accessor('executionMode', {
            cell: (info) => <span className="font-mono text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Mode',
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
                            onClick={() => onExportSession(info.row.original)}
                        >
                            <Download className="mr-2 size-4" />
                            Export session
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
            enableSorting: false,
            header: '',
            id: 'actions',
        }),
    ] as const;

export const QoderSessionsTable = ({ onExportSession, sessions }: QoderSessionsTableProps) => {
    const tableColumns = useMemo(() => columns(onExportSession), [onExportSession]);

    return (
        <DataTable
            columns={tableColumns}
            data={sessions}
            emptyMessage="No Qoder sessions match the current workspace filter."
            initialSorting={defaultSorting}
        />
    );
};
