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
        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                {title}
            </h3>
            <dl className="mt-4 space-y-3">
                {items.map((item) => (
                    <div key={item.label} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:items-start">
                        <dt className="font-medium text-[var(--muted-foreground)] text-xs uppercase tracking-[0.14em]">
                            {item.label}
                        </dt>
                        <dd className="min-w-0 text-sm leading-6">{item.value}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
