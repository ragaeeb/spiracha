import type { ProjectSummary } from '@spiracha/lib/codex-browser-types';
import { useNavigate } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { DataTable } from '#/components/data-table';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { formatDateTime, formatList, formatNumber, formatTokens } from '#/lib/formatters';

type ProjectsTableProps = {
    projects: ProjectSummary[];
    onDeleteProject: (project: ProjectSummary) => void;
};

const columnHelper = createColumnHelper<ProjectSummary>();

const columns = (onDeleteProject: (project: ProjectSummary) => void) =>
    [
        columnHelper.accessor('name', {
            cell: (info) => (
                <div className="space-y-1">
                    <p className="font-medium">{info.getValue()}</p>
                    <p className="text-[var(--muted-foreground)] text-xs">
                        {formatNumber(info.row.original.cwdPaths.length)} cwd path
                        {info.row.original.cwdPaths.length === 1 ? '' : 's'}
                    </p>
                </div>
            ),
            header: 'Project',
        }),
        columnHelper.accessor('threadCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Threads',
        }),
        columnHelper.accessor('totalTokens', {
            cell: (info) => <span className="font-mono text-sm">{formatTokens(info.getValue())}</span>,
            header: 'Tokens',
        }),
        columnHelper.accessor('lastUpdatedAtMs', {
            cell: (info) => (
                <span className="text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Last updated',
        }),
        columnHelper.display({
            cell: (info) => (
                <span className="text-[var(--muted-foreground)] text-sm">
                    {formatList(info.row.original.modelNames)}
                </span>
            ),
            header: 'Models',
            id: 'models',
        }),
        columnHelper.accessor('archivedThreadCount', {
            cell: (info) => <span className="text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Archived',
        }),
        columnHelper.display({
            cell: (info) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
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
                            className="text-[var(--destructive)]"
                            onClick={() => onDeleteProject(info.row.original)}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete project
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
            header: '',
            id: 'actions',
        }),
    ] as const;

export function ProjectsTable({ projects, onDeleteProject }: ProjectsTableProps) {
    const navigate = useNavigate();

    return (
        <DataTable
            columns={columns(onDeleteProject)}
            data={projects}
            emptyMessage="No projects match the current search."
            onRowClick={(project) =>
                navigate({
                    params: {
                        project: project.name,
                    },
                    to: '/projects/$project',
                })
            }
        />
    );
}
