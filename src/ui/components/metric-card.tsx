import type { ReactNode } from 'react';

type MetricCardProps = {
    helper?: string;
    label: string;
    value: ReactNode;
};

export function MetricCard({ helper, label, value }: MetricCardProps) {
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-[var(--panel-shadow)]">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted-foreground)] uppercase">
                {label}
            </p>
            <p className="mt-1.5 truncate text-base font-semibold tracking-[-0.03em]">{value}</p>
            {helper ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{helper}</p> : null}
        </div>
    );
}
