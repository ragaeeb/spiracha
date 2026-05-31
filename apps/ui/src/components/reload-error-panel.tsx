type ReloadErrorPanelProps = {
    description: string;
    title: string;
};

export function ReloadErrorPanel({ description, title }: ReloadErrorPanelProps) {
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-6 py-10 text-center">
            <p className="font-medium text-[var(--destructive)] text-sm">{title}</p>
            <p className="mt-2 text-[var(--muted-foreground)] text-sm">{description}</p>
            <button
                className="mt-4 text-[var(--accent)] text-sm underline-offset-2 hover:underline"
                type="button"
                onClick={() => window.location.reload()}
            >
                Reload
            </button>
        </div>
    );
}
