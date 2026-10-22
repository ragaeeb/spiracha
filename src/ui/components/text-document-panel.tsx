type TextDocumentPanelProps = {
    content: string;
    description?: string;
    title: string;
};

export const TextDocumentPanel = ({ content, description, title }: TextDocumentPanelProps) => {
    return (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
            <h3 className="text-xs font-semibold tracking-[0.18em] text-[var(--muted-foreground)] uppercase">
                {title}
            </h3>
            {description ? <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{description}</p> : null}
            <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--code-background)] p-3 text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {content}
            </pre>
        </section>
    );
};
