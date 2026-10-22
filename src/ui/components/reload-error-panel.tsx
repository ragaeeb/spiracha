type ReloadErrorPanelProps = {
    description: string;
    title: string;
};

export function ReloadErrorPanel({ description, title }: ReloadErrorPanelProps) {
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-6 py-10 text-center">
            <p className="text-sm font-medium text-[var(--destructive)]">{title}</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{description}</p>
            <button
                className="mt-4 text-sm text-[var(--accent)] underline-offset-2 hover:underline"
                type="button"
                onClick={() => window.location.reload()}
            >
                Reload
            </button>
        </div>
    );
}
