import type { ThreadGoal } from '@spiracha/lib/codex-browser-types';
import { Badge } from '#/components/ui/badge';
import { formatNumber } from '#/lib/formatters';

const formatGoalStatus = (status: string) => status.replaceAll(/[-_]+/gu, ' ');

const formatElapsedTime = (seconds: number) => {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(wholeSeconds / 3_600);
    const minutes = Math.floor((wholeSeconds % 3_600) / 60);
    const remainingSeconds = wholeSeconds % 60;

    return [hours > 0 ? `${hours}h` : null, minutes > 0 ? `${minutes}m` : null, `${remainingSeconds}s`]
        .filter(Boolean)
        .join(' ');
};

const formatGoalTokens = (goal: ThreadGoal) => {
    const used = formatNumber(goal.tokensUsed);
    return goal.tokenBudget === null ? `${used} tokens used` : `${used} / ${formatNumber(goal.tokenBudget)} tokens`;
};

export function ThreadGoalsPanel({ goals }: { goals: ThreadGoal[] }) {
    return (
        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">Goals</h3>
            {goals.length === 0 ? (
                <p className="mt-4 text-[var(--muted-foreground)] text-sm">No goals were recorded for this thread.</p>
            ) : (
                <div className="mt-4 space-y-3">
                    {goals.map((goal) => (
                        <article
                            key={goal.goalId}
                            className="rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3.5"
                        >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="font-medium text-sm leading-6">{goal.objective}</p>
                                <Badge variant="outline">{formatGoalStatus(goal.status)}</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[var(--muted-foreground)] text-xs">
                                <span>{formatGoalTokens(goal)}</span>
                                <span>{formatElapsedTime(goal.timeUsedSeconds)}</span>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
