import type { CodexCloudProject } from '@spiracha/lib/codex-cloud';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Cloud } from 'lucide-react';
import { startTransition, useDeferredValue, useMemo } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { DataTable } from '#/components/data-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Button } from '#/components/ui/button';
import { codexCloudProjectsQueryOptions } from '#/lib/codex-cloud-queries';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { parseTextQuerySearch, withTextQuerySearch } from '#/lib/route-search';
import { matchesTextQuery } from '#/lib/text-filter';

export const Route = createFileRoute('/codex/cloud/')({
    component: CodexCloudProjectsPage,
    errorComponent: CodexCloudErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(codexCloudProjectsQueryOptions()),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading projects from the authenticated Codex Cloud account."
            title="Loading Codex Cloud"
        />
    ),
    validateSearch: parseTextQuerySearch,
});

function CodexCloudErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Codex Cloud projects" />;
}

const columnHelper = createDataTableColumnHelper<CodexCloudProject>();

const compareDateValues = (left: unknown, right: unknown) =>
    (Date.parse(String(left ?? '')) || 0) - (Date.parse(String(right ?? '')) || 0);

const columns = [
    columnHelper.accessor('label', {
        cell: (info) => (
            <Link
                className="block min-w-[14rem] rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                params={{ environmentId: info.row.original.id }}
                to="/codex/cloud/projects/$environmentId"
            >
                <p className="font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                <p className="text-[var(--muted-foreground)] text-xs">Codex Cloud environment</p>
            </Link>
        ),
        header: 'Project',
    }),
    columnHelper.accessor('taskCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Threads',
    }),
    columnHelper.accessor('statuses', {
        cell: (info) => <span className="text-sm">{formatList(info.getValue())}</span>,
        header: 'States',
    }),
    columnHelper.accessor('lastUpdatedAt', {
        cell: (info) => (
            <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                {formatDateTime(info.getValue())}
            </span>
        ),
        header: 'Last updated',
        sortFn: (left, right, columnId) => compareDateValues(left.getValue(columnId), right.getValue(columnId)),
    }),
] as const;

function CodexCloudProjectsPage() {
    const navigate = Route.useNavigate();
    const search = Route.useSearch();
    const projects = useSuspenseQuery(codexCloudProjectsQueryOptions()).data;
    const searchInput = search.q ?? '';
    const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
    const visibleProjects = useMemo(
        () =>
            projects.filter((project) =>
                matchesTextQuery(deferredSearch, [
                    project.label,
                    project.statuses.join('\n'),
                    ...project.tasks.map((task) => task.title),
                ]),
            ),
        [deferredSearch, projects],
    );
    const isPartial = projects.some((project) => project.partial);

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button asChild className="rounded-full" variant="outline">
                            <Link to="/codex">
                                <Cloud className="mr-2 size-4" />
                                Local Codex
                            </Link>
                        </Button>
                        <ListSearchInput
                            placeholder="Search Cloud projects or tasks"
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
                breadcrumb={<Breadcrumbs items={[{ label: 'Codex', to: '/codex' }, { label: 'Cloud' }]} />}
                eyebrow="Authenticated inventory"
                subtitle="Read-only projects and tasks from the Codex Cloud account used by this machine."
                title="Codex Cloud"
            />

            {isPartial ? (
                <p className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[var(--muted-foreground)] text-sm">
                    Showing a bounded inventory of Cloud tasks. Refresh after reviewing the visible projects to load the
                    next current-task window.
                </p>
            ) : null}

            <DataTable
                columns={columns}
                data={visibleProjects}
                emptyMessage="No Codex Cloud projects match the current search."
                initialSorting={[{ desc: true, id: 'lastUpdatedAt' }]}
                getRowId={(row) => row.id}
            />
        </div>
    );
}
