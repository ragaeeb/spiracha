import { Loader2 } from 'lucide-react';

type LoadingPanelProps = {
    description?: string;
    title?: string;
};

export function LoadingPanel({
    description = 'Fetching local Codex data. Larger projects can take a moment.',
    title = 'Loading',
}: LoadingPanelProps) {
    return (
        <div className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] px-6 py-10 text-center shadow-[var(--panel-shadow)]">
            <div className="flex justify-center">
                <div className="rounded-full border border-[var(--border)] bg-[var(--panel-secondary)] p-3">
                    <Loader2 className="size-5 animate-spin text-[var(--accent)]" />
                </div>
            </div>
            <p className="mt-4 font-medium text-sm">{title}</p>
            <p className="mt-2 text-[var(--muted-foreground)] text-sm">{description}</p>
        </div>
    );
}
