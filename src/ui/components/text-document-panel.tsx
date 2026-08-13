type TextDocumentPanelProps = {
    content: string;
    description?: string;
    title: string;
};

export const TextDocumentPanel = ({ content, description, title }: TextDocumentPanelProps) => {
    return (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-[0.18em]">
                {title}
            </h3>
            {description ? <p className="mt-1.5 text-[var(--muted-foreground)] text-sm">{description}</p> : null}
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--code-background)] p-3 text-sm leading-6 [overflow-wrap:anywhere]">
                {content}
            </pre>
        </section>
    );
};
