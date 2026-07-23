import type { KiroSessionSummary } from '@spiracha/lib/kiro-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
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
import { formatDateTime, formatNumber } from '#/lib/formatters';

type KiroSessionsTableProps = {
    merged?: boolean;
    onDeleteSession: (session: KiroSessionSummary) => void;
    onDeleteSessions: (sessionIds: string[]) => void;
    onExportSession: (session: KiroSessionSummary) => void;
    onExportSessions: (sessionIds: string[]) => void;
    sessions: KiroSessionSummary[];
};

const columnHelper = createColumnHelper<KiroSessionSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'lastActive' }];

const columns = (
    merged: boolean,
    onDeleteSession: (session: KiroSessionSummary) => void,
    onExportSession: (session: KiroSessionSummary) => void,
) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ sessionId: info.row.original.sessionId }}
                    search={merged ? { merged: true } : undefined}
                    to="/kiro-sessions/$sessionId"
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
        columnHelper.accessor('selectedModel', {
            cell: (info) => <span className="text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Model',
        }),
        columnHelper.accessor('messageCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Messages',
        }),
        columnHelper.accessor('imageCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Images',
        }),
        columnHelper.accessor('promptLogCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Prompt logs',
        }),
        columnHelper.accessor('sessionType', {
            cell: (info) => <span className="font-mono text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Type',
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
                        <DropdownMenuItem
                            className="text-[var(--destructive)]"
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

export const KiroSessionsTable = ({
    merged = false,
    onDeleteSession,
    onDeleteSessions,
    onExportSession,
    onExportSessions,
    sessions,
}: KiroSessionsTableProps) => {
    const tableColumns = useMemo(
        () => columns(merged, onDeleteSession, onExportSession),
        [merged, onDeleteSession, onExportSession],
    );

    return (
        <DataTable
            columns={tableColumns}
            data={sessions}
            emptyMessage="No Kiro sessions match the current workspace filter."
            enableRowSelection
            getRowId={(row) => row.sessionId}
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
};
