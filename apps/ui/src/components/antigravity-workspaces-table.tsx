import type { AntigravityWorkspaceGroup } from '@spiracha/lib/antigravity-exporter-types';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable } from '#/components/data-table';
import { formatBytes, formatDateTime, formatNumber } from '#/lib/formatters';

type AntigravityWorkspacesTableProps = {
    workspaces: AntigravityWorkspaceGroup[];
};

const columnHelper = createColumnHelper<AntigravityWorkspaceGroup>();

const columns = [
    columnHelper.accessor('label', {
        cell: (info) => (
            <Link
                className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                params={{ workspaceKey: info.row.original.key }}
                to="/antigravity/$workspaceKey"
            >
                <p className="font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                <p className="truncate text-[var(--muted-foreground)] text-xs">
                    {info.row.original.uri ?? 'Unknown root'}
                </p>
            </Link>
        ),
        header: 'Workspace',
    }),
    columnHelper.accessor('conversationCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Conversations',
    }),
    columnHelper.accessor('transcriptCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Transcripts',
    }),
    columnHelper.accessor('artifactCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Artifacts',
    }),
    columnHelper.accessor('totalBytes', {
        cell: (info) => <span className="font-mono text-sm">{formatBytes(info.getValue())}</span>,
        header: 'Size',
    }),
    columnHelper.accessor('lastActiveMs', {
        cell: (info) => (
            <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                {formatDateTime(info.getValue())}
            </span>
        ),
        header: 'Last updated',
    }),
] as const;

export function AntigravityWorkspacesTable({ workspaces }: AntigravityWorkspacesTableProps) {
    return (
        <DataTable
            columns={columns}
            data={workspaces}
            emptyMessage="No Antigravity workspaces match the current search."
        />
    );
}
