type TextDocumentPanelProps = {
    content: string;
    description?: string;
    title: string;
};

export function TextDocumentPanel({ content, description, title }: TextDocumentPanelProps) {
    return (
        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                {title}
            </h3>
            {description ? <p className="mt-2 text-[var(--muted-foreground)] text-sm">{description}</p> : null}
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-[var(--code-background)] p-4 text-sm leading-6 [overflow-wrap:anywhere]">
                {content}
            </pre>
        </section>
    );
}
