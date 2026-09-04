import type { CodexCloudTask } from '@spiracha/lib/codex-cloud';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { startTransition, useDeferredValue, useMemo } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { DataTable } from '#/components/data-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { codexCloudProjectQueryOptions } from '#/lib/codex-cloud-queries';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';
import { parseTextQuerySearch, withTextQuerySearch } from '#/lib/route-search';
import { matchesTextQuery } from '#/lib/text-filter';

export const Route = createFileRoute('/codex/cloud/projects/$environmentId')({
    component: CodexCloudProjectPage,
    errorComponent: CodexCloudProjectErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(codexCloudProjectQueryOptions(params.environmentId)),
    pendingComponent: () => (
        <LoadingPanel description="Loading the read-only Cloud task list." title="Loading Cloud project" />
    ),
    validateSearch: parseTextQuerySearch,
});

function CodexCloudProjectErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Codex Cloud project" />;
}

const columnHelper = createDataTableColumnHelper<CodexCloudTask>();

const compareDateValues = (left: unknown, right: unknown) =>
    (Date.parse(String(left ?? '')) || 0) - (Date.parse(String(right ?? '')) || 0);

const columns = [
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
        cell: (info) => {
            const stats = info.getValue();
            const files = stats.filesModified === null ? 'n/a' : formatNumber(stats.filesModified);
            const additions = stats.linesAdded === null ? 'n/a' : `+${formatNumber(stats.linesAdded)}`;
            const removals = stats.linesRemoved === null ? 'n/a' : `-${formatNumber(stats.linesRemoved)}`;
            return (
                <span className="whitespace-nowrap font-mono text-sm">{`${files} files · ${additions}/${removals}`}</span>
            );
        },
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
] as const;

function CodexCloudProjectPage() {
    const navigate = Route.useNavigate();
    const { environmentId } = Route.useParams();
    const search = Route.useSearch();
    const project = useSuspenseQuery(codexCloudProjectQueryOptions(environmentId)).data;
    const searchInput = search.q ?? '';
    const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
    const visibleTasks = useMemo(
        () => project.tasks.filter((task) => matchesTextQuery(deferredSearch, [task.title, task.id, task.status])),
        [deferredSearch, project.tasks],
    );

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button asChild className="rounded-full" variant="outline">
                            <Link to="/codex/cloud">
                                <ArrowLeft className="mr-2 size-4" />
                                Cloud projects
                            </Link>
                        </Button>
                        <ListSearchInput
                            placeholder="Search Cloud thread title, id, or state"
                            value={searchInput}
                            onValueChange={(value) => {
                                startTransition(() => {
                                    void navigate({
                                        replace: true,
                                        search: (previous) => withTextQuerySearch(previous, value),
                                    });
                                });
                            }}
                        />
                    </div>
                }
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'Codex', to: '/codex' },
                            { label: 'Cloud', to: '/codex/cloud' },
                            { label: project.label, truncate: true },
                        ]}
                    />
                }
                eyebrow="Codex Cloud project"
                subtitle={`${project.taskCount} current task${project.taskCount === 1 ? '' : 's'} · read-only Cloud history`}
                title={project.label}
            />

            {project.partial ? (
                <p className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[var(--muted-foreground)] text-sm">
                    This project is from a bounded Cloud inventory. Some older current tasks may be outside the loaded
                    window.
                </p>
            ) : null}

            <DataTable
                columns={columns}
                data={visibleTasks}
                emptyMessage="No Cloud threads match the current search."
                getRowId={(row) => row.id}
                initialSorting={[{ desc: true, id: 'updatedAt' }]}
            />
        </div>
    );
}
