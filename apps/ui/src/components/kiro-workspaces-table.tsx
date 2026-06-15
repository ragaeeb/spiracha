import type { KiroWorkspaceGroup } from '@spiracha/lib/kiro-exporter-types';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable } from '#/components/data-table';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type KiroWorkspacesTableProps = {
    workspaces: KiroWorkspaceGroup[];
};

const columnHelper = createColumnHelper<KiroWorkspaceGroup>();

const columns = [
    columnHelper.accessor('label', {
        cell: (info) => (
            <Link
                className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                params={{ workspaceKey: info.row.original.key }}
                to="/kiro/$workspaceKey"
            >
                <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                <p className="truncate text-[var(--muted-foreground)] text-xs">{info.row.original.worktree}</p>
            </Link>
        ),
        header: 'Workspace',
    }),
    columnHelper.accessor('sessionCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Sessions',
    }),
    columnHelper.accessor('messageCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Messages',
    }),
    columnHelper.accessor('imageCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Images',
    }),
    columnHelper.accessor('lastActiveAtMs', {
        cell: (info) => (
            <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                {formatDateTime(info.getValue())}
            </span>
        ),
        header: 'Last active',
    }),
] as const;

export function KiroWorkspacesTable({ workspaces }: KiroWorkspacesTableProps) {
    return (
        <DataTable columns={columns} data={workspaces} emptyMessage="No Kiro workspaces match the current search." />
    );
}
