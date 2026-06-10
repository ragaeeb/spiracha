import type { ModelTokenSummary, ToolUsageSummary } from '@spiracha/lib/codex-browser-types';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { startTransition } from 'react';
import { DataTable } from '#/components/data-table';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select';
import { analyticsQueryOptions, projectsQueryOptions } from '#/lib/codex-queries';
import { formatNumber, formatTokens } from '#/lib/formatters';
import { parseAnalyticsSearch, withAnalyticsProjectSearch } from '#/lib/route-search';

const toolUsageColumnHelper = createColumnHelper<ToolUsageSummary>();
const toolUsageColumns = [
    toolUsageColumnHelper.accessor('name', {
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
        header: 'Tool',
    }),
    toolUsageColumnHelper.accessor('count', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Calls',
    }),
] as const;

const modelColumnHelper = createColumnHelper<ModelTokenSummary>();
const modelColumns = [
    modelColumnHelper.accessor('model', {
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
        header: 'Model',
    }),
    modelColumnHelper.accessor('threadCount', {
        cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
        header: 'Threads',
    }),
    modelColumnHelper.accessor('totalTokens', {
        cell: (info) => <span className="font-mono text-sm">{formatTokens(info.getValue())}</span>,
        header: 'Tokens',
    }),
] as const;

export const Route = createFileRoute('/analytics')({
    component: AnalyticsPage,
    loader: ({ context, deps }) => {
        const { project } = deps as { project: string | null };
        return Promise.all([
            context.queryClient.ensureQueryData(projectsQueryOptions()),
            context.queryClient.ensureQueryData(analyticsQueryOptions(project)),
        ]);
    },
    loaderDeps: ({ search }) => ({ project: parseAnalyticsSearch(search).project ?? null }),
    validateSearch: parseAnalyticsSearch,
});

function AnalyticsPage() {
    const navigate = useNavigate({ from: Route.fullPath });
    const projects = useSuspenseQuery(projectsQueryOptions()).data;
    const search = Route.useSearch();
    const selectedProject = search.project ?? null;
    const analytics = useSuspenseQuery(analyticsQueryOptions(selectedProject)).data;

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <Select
                        value={selectedProject ?? '__all__'}
                        onValueChange={(value) => {
                            startTransition(() => {
                                void navigate({
                                    replace: true,
                                    search: (previous: Record<string, unknown>) =>
                                        withAnalyticsProjectSearch(previous, value === '__all__' ? null : value),
                                });
                            });
                        }}
                    >
                        <SelectTrigger className="h-10 w-full rounded-full border-[var(--border)] bg-[var(--panel)] sm:w-[15rem]">
                            <SelectValue placeholder="Filter by project" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">All projects</SelectItem>
                            {projects.map((project) => (
                                <SelectItem key={project.name} value={project.name}>
                                    {project.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                }
                eyebrow="Analytics"
                subtitle="Inspect token load, tool-call distribution, and project-scoped usage patterns to understand where Codex is spending effort."
                title="Analytics"
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard label="Threads" value={formatNumber(analytics.summary.totalThreads)} />
                <MetricCard label="Projects" value={formatNumber(analytics.summary.totalProjects)} />
                <MetricCard label="Tokens" value={formatTokens(analytics.summary.totalTokens)} />
                <MetricCard
                    label="Average per thread"
                    value={formatTokens(Math.round(analytics.summary.averageTokensPerThread))}
                />
                <MetricCard label="Web search threads" value={formatNumber(analytics.summary.threadsWithWebSearch)} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <section className="space-y-4">
                    <div>
                        <h3 className="font-semibold text-sm">Most frequent tool calls</h3>
                        <p className="mt-1 text-[var(--muted-foreground)] text-sm">
                            Useful for future prompt and tool optimization work.
                        </p>
                    </div>
                    <DataTable
                        columns={toolUsageColumns}
                        data={analytics.toolUsage}
                        emptyMessage="No tool calls recorded."
                    />
                </section>

                <section className="space-y-4">
                    <div>
                        <h3 className="font-semibold text-sm">Model token breakdown</h3>
                        <p className="mt-1 text-[var(--muted-foreground)] text-sm">
                            Compare model usage and token concentration within the current project scope.
                        </p>
                    </div>
                    <DataTable
                        columns={modelColumns}
                        data={analytics.modelsByTokens}
                        emptyMessage="No model usage recorded."
                    />
                </section>
            </div>
        </div>
    );
}
