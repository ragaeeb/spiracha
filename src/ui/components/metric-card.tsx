import type { ReactNode } from 'react';

type MetricCardProps = {
    helper?: string;
    label: string;
    value: ReactNode;
};

export function MetricCard({ helper, label, value }: MetricCardProps) {
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-[var(--panel-shadow)]">
            <p className="font-semibold text-[10px] text-[var(--muted-foreground)] uppercase tracking-[0.18em]">
                {label}
            </p>
            <p className="mt-1.5 truncate font-semibold text-base tracking-[-0.03em]">{value}</p>
            {helper ? <p className="mt-1 text-[var(--muted-foreground)] text-xs">{helper}</p> : null}
        </div>
    );
}
