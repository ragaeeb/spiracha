import type { CodexCloudTask } from '@spiracha/lib/codex-cloud';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { Download, ExternalLink, MoreHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { SelectionActionsToolbar } from '#/components/selection-actions-toolbar';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type CodexCloudTasksTableProps = {
    emptyMessage: string;
    onExportTask: (task: CodexCloudTask) => void;
    onExportTasks: (taskIds: string[]) => void;
    tasks: CodexCloudTask[];
};

const columnHelper = createDataTableColumnHelper<CodexCloudTask>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];

export const CODEX_CLOUD_READONLY_COPY =
    'Normalized export is available in Spiracha. Original files and deletion stay on the Codex Cloud account.';

export const CodexCloudReadOnlyNotice = () => (
    <p className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[var(--muted-foreground)] text-sm">
        {CODEX_CLOUD_READONLY_COPY}
    </p>
);

const compareDateValues = (left: unknown, right: unknown) =>
    (Date.parse(String(left ?? '')) || 0) - (Date.parse(String(right ?? '')) || 0);

const diffLabel = (stats: CodexCloudTask['diffStats']) => {
    const files = stats.filesModified === null ? 'n/a' : formatNumber(stats.filesModified);
    const additions = stats.linesAdded === null ? 'n/a' : `+${formatNumber(stats.linesAdded)}`;
    const removals = stats.linesRemoved === null ? 'n/a' : `-${formatNumber(stats.linesRemoved)}`;
    return `${files} files · ${additions}/${removals}`;
};

const buildColumns = (onExportTask: (task: CodexCloudTask) => void) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block min-w-[18rem] rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    params={{ taskId: info.row.original.id }}
                    to="/codex/cloud/tasks/$taskId"
                >
                    <p className="font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                    <p className="font-mono text-[var(--muted-foreground)] text-xs">{info.row.original.id}</p>
                </Link>
            ),
            header: 'Thread',
        }),
        columnHelper.accessor('status', {
            cell: (info) => <Badge variant="outline">{info.getValue()}</Badge>,
            header: 'State',
        }),
        columnHelper.accessor('updatedAt', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Updated',
            sortFn: (left, right, columnId) => compareDateValues(left.getValue(columnId), right.getValue(columnId)),
        }),
        columnHelper.accessor('diffStats', {
            cell: (info) => <span className="whitespace-nowrap font-mono text-sm">{diffLabel(info.getValue())}</span>,
            header: 'Diff',
            id: 'diff',
        }),
        columnHelper.display({
            cell: (info) => (
                <a
                    aria-label={`Open ${info.row.original.title} in Codex Cloud`}
                    className="inline-flex items-center gap-1 text-[var(--muted-foreground)] text-sm hover:text-[var(--foreground)]"
                    href={info.row.original.taskUrl}
                    rel="noreferrer"
                    target="_blank"
                >
                    <ExternalLink className="size-4" />
                    Cloud
                </a>
            ),
            enableSorting: false,
            header: '',
            id: 'external',
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
                        >
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onExportTask(info.row.original)}>
                            <Download className="mr-2 size-4" />
                            Export
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
            enableSorting: false,
            header: '',
            id: 'actions',
        }),
    ] as const;

export const CodexCloudTasksTable = ({
    emptyMessage,
    onExportTask,
    onExportTasks,
    tasks,
}: CodexCloudTasksTableProps) => {
    const columns = useMemo(() => buildColumns(onExportTask), [onExportTask]);

    return (
        <DataTable
            columns={columns}
            data={tasks}
            emptyMessage={emptyMessage}
            enableRowSelection
            getRowId={(row) => row.id}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => (
                <SelectionActionsToolbar
                    clearSelection={clearSelection}
                    itemLabel="thread"
                    selectedCount={selectedRows.length}
                    onExportSelected={() => onExportTasks(selectedRows.map((row) => row.id))}
                />
            )}
        />
    );
};
