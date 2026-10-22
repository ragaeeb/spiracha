import type { ReactNode } from 'react';

type MetadataItem = {
    label: string;
    value: ReactNode;
};

type MetadataSectionProps = {
    items: MetadataItem[];
    title: string;
};

export function MetadataSection({ items, title }: MetadataSectionProps) {
    return (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
            <h3 className="text-xs font-semibold tracking-[0.18em] text-[var(--muted-foreground)] uppercase">
                {title}
            </h3>
            <dl className="mt-3 space-y-2">
                {items.map((item) => (
                    <div key={item.label} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:items-start">
                        <dt className="text-xs font-medium tracking-[0.14em] text-[var(--muted-foreground)] uppercase">
                            {item.label}
                        </dt>
                        <dd className="min-w-0 text-sm leading-5">{item.value}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
