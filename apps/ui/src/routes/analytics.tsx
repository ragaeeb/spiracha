import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { startTransition } from 'react';
import { AnalyticsBreakdowns } from '#/components/analytics-breakdowns';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select';
import { analyticsQueryOptions, projectsQueryOptions } from '#/lib/codex-queries';
import { formatNumber, formatTokens } from '#/lib/formatters';
import {
    decodeAnalyticsProjectSelectValue,
    encodeAnalyticsProjectSelectValue,
    parseAnalyticsSearch,
    withAnalyticsProjectSearch,
} from '#/lib/route-search';

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
                        value={encodeAnalyticsProjectSelectValue(selectedProject)}
                        onValueChange={(value) => {
                            startTransition(() => {
                                void navigate({
                                    replace: true,
                                    search: (previous: Record<string, unknown>) =>
                                        withAnalyticsProjectSearch(previous, decodeAnalyticsProjectSelectValue(value)),
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
                                <SelectItem key={project.name} value={encodeAnalyticsProjectSelectValue(project.name)}>
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

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Threads" value={formatNumber(analytics.summary.totalThreads)} />
                <MetricCard label="Projects" value={formatNumber(analytics.summary.totalProjects)} />
                <MetricCard label="Tokens" value={formatTokens(analytics.summary.totalTokens)} />
                <MetricCard
                    label="Average per thread"
                    value={formatTokens(Math.round(analytics.summary.averageTokensPerThread))}
                />
                <MetricCard label="Median per thread" value={formatTokens(analytics.summary.medianTokensPerThread)} />
                <MetricCard label="Web search threads" value={formatNumber(analytics.summary.threadsWithWebSearch)} />
                <MetricCard label="Archived threads" value={formatNumber(analytics.summary.archivedThreads)} />
            </div>

            <AnalyticsBreakdowns
                modelsByTokens={analytics.modelsByTokens}
                reasoningEfforts={analytics.reasoningEfforts}
                sources={analytics.sources}
                toolUsage={analytics.toolUsage}
            />
        </div>
    );
}
