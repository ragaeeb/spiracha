import { Loader2 } from 'lucide-react';

type LoadingPanelProps = {
    description?: string;
    title?: string;
};

export function LoadingPanel({
    description = 'Fetching local data. Larger workspaces can take a moment.',
    title = 'Loading',
}: LoadingPanelProps) {
    return (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-5 py-8 text-center shadow-[var(--panel-shadow)]">
            <div className="flex justify-center">
                <div className="rounded-full border border-[var(--border)] bg-[var(--panel-secondary)] p-2.5">
                    <Loader2 className="size-5 animate-spin text-[var(--accent)]" />
                </div>
            </div>
            <p className="mt-3 font-medium text-sm">{title}</p>
            <p className="mt-1.5 text-[var(--muted-foreground)] text-sm">{description}</p>
        </div>
    );
}
