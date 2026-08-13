import type { ClineTaskSummary } from '@spiracha/lib/cline-exporter-types';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { Download, MoreHorizontal, Star, Trash2 } from 'lucide-react';
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

type Props = {
    onDeleteSession: (task: ClineTaskSummary) => void;
    onDeleteSessions: (taskIds: string[]) => void;
    onExportSession: (task: ClineTaskSummary) => void;
    onExportSessions: (taskIds: string[]) => void;
    sessions: ClineTaskSummary[];
};

const columnHelper = createDataTableColumnHelper<ClineTaskSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'lastActive' }];

const buildColumns = (onDelete: Props['onDeleteSession'], onExport: Props['onExportSession']) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ taskId: info.row.original.taskId }}
                    to="/cline-tasks/$taskId"
                >
                    <p className="flex items-center gap-1 truncate font-medium underline-offset-2 hover:underline">
                        {info.row.original.isFavorited ? (
                            <>
                                <Star aria-hidden="true" className="size-3 fill-current" />
                                <span className="sr-only">favorite</span>
                            </>
                        ) : null}
                        {info.getValue()}
                    </p>
                    <p className="truncate text-[var(--muted-foreground)] text-xs">{info.row.original.taskId}</p>
                </Link>
            ),
            header: 'Chat',
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
        columnHelper.accessor('modelId', {
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
                        <DropdownMenuItem onClick={() => onExport(info.row.original)}>
                            <Download className="mr-2 size-4" /> Export session
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-[var(--destructive)]"
                            onClick={() => onDelete(info.row.original)}
                        >
                            <Trash2 className="mr-2 size-4" /> Delete session
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
            header: '',
            id: 'actions',
        }),
    ] as const;

export const ClineTasksTable = ({
    onDeleteSession,
    onDeleteSessions,
    onExportSession,
    onExportSessions,
    sessions,
}: Props) => {
    const columns = useMemo(() => buildColumns(onDeleteSession, onExportSession), [onDeleteSession, onExportSession]);
    return (
        <DataTable
            columns={columns}
            data={sessions}
            emptyMessage="No Cline chats match the current workspace filter."
            enableRowSelection
            getRowId={(row) => row.taskId}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => (
                <SelectionActionsToolbar
                    clearSelection={clearSelection}
                    itemLabel="session"
                    selectedCount={selectedRows.length}
                    onDeleteSelected={() => onDeleteSessions(selectedRows.map((row) => row.taskId))}
                    onExportSelected={() => onExportSessions(selectedRows.map((row) => row.taskId))}
                />
            )}
        />
    );
};
