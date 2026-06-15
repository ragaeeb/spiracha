import type { OpenCodeSessionSummary } from '@spiracha/lib/opencode-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, MoreHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { formatDateTime, formatNumber, formatTokens } from '#/lib/formatters';

type OpenCodeSessionsTableProps = {
    onExportSession: (session: OpenCodeSessionSummary) => void;
    sessions: OpenCodeSessionSummary[];
};

const columnHelper = createColumnHelper<OpenCodeSessionSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];

const formatCost = (value: number) => {
    if (value <= 0) {
        return '$0';
    }

    return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
};

const columns = (onExportSession: (session: OpenCodeSessionSummary) => void) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ sessionId: info.row.original.sessionId }}
                    to="/opencode-sessions/$sessionId"
                >
                    <div className="flex items-center gap-2">
                        <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                        {info.row.original.archivedAtMs ? <Badge variant="outline">archived</Badge> : null}
                    </div>
                    <p className="truncate text-[var(--muted-foreground)] text-xs">
                        {info.row.original.slug} · {info.row.original.sessionId}
                    </p>
                </Link>
            ),
            header: 'Session',
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
        columnHelper.accessor('agent', {
            cell: (info) => <span className="font-mono text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Agent',
        }),
        columnHelper.accessor('modelLabel', {
            cell: (info) => <span className="text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Model',
        }),
        columnHelper.accessor('messageCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Messages',
        }),
        columnHelper.accessor('totalTokens', {
            cell: (info) => (
                <span className="whitespace-nowrap font-mono text-sm">{formatTokens(info.getValue())}</span>
            ),
            header: 'Tokens',
        }),
        columnHelper.accessor('cost', {
            cell: (info) => <span className="font-mono text-sm">{formatCost(info.getValue())}</span>,
            header: 'Cost',
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

export function OpenCodeSessionsTable({ onExportSession, sessions }: OpenCodeSessionsTableProps) {
    const tableColumns = useMemo(() => columns(onExportSession), [onExportSession]);

    return (
        <DataTable
            columns={tableColumns}
            data={sessions}
            emptyMessage="No OpenCode sessions match the current workspace filter."
            initialSorting={defaultSorting}
        />
    );
}
