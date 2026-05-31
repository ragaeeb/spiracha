import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { RecentThreadsList } from '#/components/recent-threads-list';
import { dashboardQueryOptions } from '#/lib/codex-queries';
import { formatNumber, formatTokens } from '#/lib/formatters';

export const Route = createFileRoute('/')({
    component: DashboardPage,
    loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions()),
});

function DashboardErrorComponent({ error }: { error: Error }) {
    const isSqlite = error.message.includes('unable to open database') || error.message.includes('database is locked');
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-6 py-10 text-center">
            <p className="font-medium text-[var(--destructive)] text-sm">
                {isSqlite ? 'Database unavailable' : 'Failed to load dashboard'}
            </p>
            <p className="mt-2 text-[var(--muted-foreground)] text-sm">
                {isSqlite ? 'Codex may have an exclusive lock on the database. Reload to retry.' : error.message}
            </p>
            <button
                className="mt-4 text-[var(--accent)] text-sm underline-offset-2 hover:underline"
                type="button"
                onClick={() => window.location.reload()}
            >
                Reload
            </button>
        </div>
    );
}

Route.update({ errorComponent: DashboardErrorComponent });

function DashboardPage() {
    const dashboard = useSuspenseQuery(dashboardQueryOptions()).data;

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <img
                        alt="Spiracha icon"
                        className="size-16 shrink-0 rounded-2xl border border-[var(--border)] bg-white/95 p-2 shadow-[var(--panel-shadow)]"
                        src="/icon.svg"
                    />
                }
                eyebrow="Overview"
                subtitle="A compact readout of local Codex activity, project distribution, and recent thread movement."
                title="Dashboard"
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Threads" value={formatNumber(dashboard.totalThreads)} />
                <MetricCard label="Projects" value={formatNumber(dashboard.totalProjects)} />
                <MetricCard label="Tokens" value={formatTokens(dashboard.totalTokens)} />
                <MetricCard
                    helper={`${formatNumber(dashboard.archivedThreads)} archived`}
                    label="Active"
                    value={formatNumber(dashboard.activeThreads)}
                />
            </div>

            <div className="grid min-w-0 gap-4 xl:grid-cols-[1.4fr_1fr]">
                <section className="min-w-0 overflow-hidden rounded-[1.8rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="font-semibold text-sm">Recent threads</p>
                            <p className="mt-0.5 text-[var(--muted-foreground)] text-xs">
                                Most recently updated threads across the local Codex database.
                            </p>
                        </div>
                        <Link className="shrink-0 font-medium text-[var(--accent)] text-sm" to="/projects">
                            View Codex
                        </Link>
                    </div>
                    <RecentThreadsList threads={dashboard.recentThreads} />
                </section>

                <div className="grid min-w-0 gap-4">
                    <section className="min-w-0 overflow-hidden rounded-[1.8rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                        <p className="font-semibold text-sm">Top projects by thread count</p>
                        <div className="mt-3 space-y-2">
                            {dashboard.topProjectsByThreadCount.map((project) => (
                                <Link
                                    key={project.name}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-secondary)] px-3.5 py-2.5 text-sm"
                                    params={{ project: project.name }}
                                    to="/projects/$project"
                                >
                                    <span className="truncate">{project.name}</span>
                                    <span className="shrink-0 font-mono text-[var(--muted-foreground)]">
                                        {formatNumber(project.threadCount)}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </section>

                    <section className="min-w-0 overflow-hidden rounded-[1.8rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                        <p className="font-semibold text-sm">Top projects by tokens</p>
                        <div className="mt-3 space-y-2">
                            {dashboard.topProjectsByTokens.map((project) => (
                                <Link
                                    key={project.name}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-secondary)] px-3.5 py-2.5 text-sm"
                                    params={{ project: project.name }}
                                    to="/projects/$project"
                                >
                                    <span className="truncate">{project.name}</span>
                                    <span className="shrink-0 font-mono text-[var(--muted-foreground)]">
                                        {formatTokens(project.totalTokens)}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
