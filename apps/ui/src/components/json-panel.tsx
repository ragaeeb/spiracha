type JsonPanelProps = {
    title: string;
    value: unknown;
};

export function JsonPanel({ title, value }: JsonPanelProps) {
    return (
        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                {title}
            </h3>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--code-background)] p-4 text-[var(--code-foreground)] text-xs leading-5">
                {JSON.stringify(value, null, 2)}
            </pre>
        </section>
    );
}
