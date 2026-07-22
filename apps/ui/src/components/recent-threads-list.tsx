import type { DashboardRecentThread } from '@spiracha/lib/codex-browser-types';
import { Link } from '@tanstack/react-router';
import { formatDateTime, formatTokens } from '#/lib/formatters';

type RecentThreadsListProps = {
    threads: DashboardRecentThread[];
};

export function RecentThreadsList({ threads }: RecentThreadsListProps) {
    return (
        <div className="mt-3 space-y-2">
            {threads.map(({ project, thread }) => (
                <article
                    key={thread.id}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_7.5rem] gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3 transition-colors hover:border-[var(--accent)]/30 hover:bg-[var(--accent-muted)]"
                >
                    <div className="min-w-0">
                        <Link
                            className="block min-w-0 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            params={{ threadId: thread.id }}
                            to="/threads/$threadId"
                        >
                            <p className="truncate font-medium text-sm underline-offset-2 hover:underline">
                                {thread.title}
                            </p>
                            <p className="mt-0.5 line-clamp-1 text-[var(--muted-foreground)] text-xs">
                                {thread.preview}
                            </p>
                        </Link>
                        <div className="mt-2 flex min-w-0 flex-wrap gap-3 text-[var(--muted-foreground)] text-xs">
                            <Link
                                className="max-w-[14rem] truncate font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                                params={{ project }}
                                to="/codex/$project"
                            >
                                {project}
                            </Link>
                            <span className="font-mono">{thread.model ?? 'unknown model'}</span>
                            <span>{formatTokens(thread.tokens_used)}</span>
                        </div>
                    </div>
                    <p
                        className="justify-self-end whitespace-nowrap text-right font-mono text-[var(--muted-foreground)] text-xs"
                        suppressHydrationWarning
                    >
                        {formatDateTime(thread.updated_at_ms ?? thread.updated_at * 1000)}
                    </p>
                </article>
            ))}
        </div>
    );
}
