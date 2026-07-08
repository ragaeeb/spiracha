import type { ClaudeCodeWorkspaceGroup } from '@spiracha/lib/claude-code-exporter-types';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable } from '#/components/data-table';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type ClaudeCodeWorkspacesTableProps = {
    workspaces: ClaudeCodeWorkspaceGroup[];
};

const columnHelper = createColumnHelper<ClaudeCodeWorkspaceGroup>();

const columns = [
    columnHelper.accessor('label', {
        cell: (info) => (
            <Link
                className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                params={{ workspaceKey: info.row.original.key }}
                to="/claude-code/$workspaceKey"
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
    columnHelper.accessor('toolCallCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Tool calls',
    }),
    columnHelper.accessor('lastActiveAtMs', {
        cell: (info) => <span className="whitespace-nowrap text-sm">{formatDateTime(info.getValue())}</span>,
        header: 'Last active',
    }),
] as const;

export function ClaudeCodeWorkspacesTable({ workspaces }: ClaudeCodeWorkspacesTableProps) {
    return (
        <DataTable
            columns={columns}
            data={workspaces}
            emptyMessage="No Claude Code workspaces match the current search."
        />
    );
}
