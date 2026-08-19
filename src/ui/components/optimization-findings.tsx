import type { CodexOptimizationAnalytics, CodexOptimizationSeverity } from '@spiracha/lib/codex-browser-types';
import { formatBytes, formatNumber } from '#/lib/formatters';

type OptimizationFindingsProps = {
    optimization: CodexOptimizationAnalytics;
};

const severityClassNames: Record<CodexOptimizationSeverity, string> = {
    high: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    low: 'border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]',
    medium: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

export const OptimizationFindings = ({ optimization }: OptimizationFindingsProps) => {
    return (
        <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
            <div>
                <h2 className="font-semibold text-lg">Optimization opportunities</h2>
                <p className="mt-1 text-[var(--muted-foreground)] text-sm">
                    Deterministic transcript signals, ranked by workflow risk. Byte counts describe retained context,
                    not provider billing.
                </p>
            </div>

            {optimization.findings.length === 0 ? (
                <p className="rounded-lg border border-[var(--border)] border-dashed p-4 text-[var(--muted-foreground)] text-sm">
                    No deterministic optimization findings in this scope.
                </p>
            ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                    {optimization.findings.map((finding) => (
                        <article className="rounded-lg border border-[var(--border)] p-3" key={finding.id}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <p className="font-semibold text-sm">{finding.title}</p>
                                    <p className="mt-1 text-[var(--muted-foreground)] text-xs">
                                        {formatNumber(finding.observedCount)} occurrences across{' '}
                                        {formatNumber(finding.affectedThreads)} threads
                                        {finding.impactBytes === null
                                            ? ''
                                            : ` · ${formatBytes(finding.impactBytes)} retained`}
                                    </p>
                                </div>
                                <span
                                    className={`rounded-full border px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide ${severityClassNames[finding.severity]}`}
                                >
                                    {finding.severity}
                                </span>
                            </div>
                            <p className="mt-3 text-sm">{finding.recommendation}</p>
                        </article>
                    ))}
                </div>
            )}

            <div className="space-y-2 border-[var(--border)] border-t pt-4">
                <div>
                    <h3 className="font-semibold text-sm">Candidate persona themes</h3>
                    <p className="mt-1 text-[var(--muted-foreground)] text-xs">
                        Repeated task labels from generic subagents are review prompts, not automatic persona decisions.
                    </p>
                </div>
                {optimization.personaCandidates.length === 0 ? (
                    <p className="text-[var(--muted-foreground)] text-sm">No repeated generic delegation themes.</p>
                ) : (
                    <ul className="grid gap-2 md:grid-cols-2">
                        {optimization.personaCandidates.slice(0, 12).map((candidate) => (
                            <li
                                className="flex items-center justify-between gap-3 rounded-lg bg-[var(--muted)] px-3 py-2"
                                key={candidate.label}
                            >
                                <span className="font-mono text-sm">{candidate.label}</span>
                                <span className="shrink-0 text-[var(--muted-foreground)] text-xs">
                                    {formatNumber(candidate.count)} generic delegations
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
};
