import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { Skeleton } from '#/components/ui/skeleton';

const loadingColumns = ['Project', 'Threads', 'Tokens', 'Last updated', 'Models', 'Archived'] as const;
const loadingRows = ['project-a', 'project-b', 'project-c', 'project-d', 'project-e'] as const;

export function ProjectsLoadingState() {
    return (
        <div aria-busy="true" aria-live="polite" className="space-y-6">
            <PageHeader
                actions={<Skeleton className="h-10 w-full min-w-[16rem] max-w-[20rem]" />}
                eyebrow="Inventory"
                subtitle="Reading the local Codex database and checking fallback session files."
                title="Codex"
            />

            <div role="status">
                <LoadingPanel
                    description="Scanning project summaries. Large local histories can take a moment."
                    title="Loading Codex projects"
                />
            </div>

            <div className="w-full overflow-x-auto rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)]">
                <table className="w-full min-w-[56rem]">
                    <thead className="bg-[var(--panel-secondary)]">
                        <tr className="border-[var(--border)] border-b">
                            {loadingColumns.map((column) => (
                                <th
                                    key={column}
                                    className="h-10 whitespace-nowrap px-4 text-left font-semibold text-[11px] text-[var(--muted-foreground)] uppercase tracking-[0.18em]"
                                >
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loadingRows.map((rowId, rowIndex) => (
                            <tr
                                key={rowId}
                                aria-label={`Loading project row ${rowIndex + 1}`}
                                className="border-[var(--border)] border-b last:border-b-0"
                            >
                                <td className="px-4 py-3">
                                    <div className="space-y-2">
                                        <Skeleton aria-hidden className="h-4 w-44" />
                                        <Skeleton aria-hidden className="h-3 w-20" />
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <Skeleton aria-hidden className="h-4 w-12" />
                                </td>
                                <td className="px-4 py-3">
                                    <Skeleton aria-hidden className="h-4 w-16" />
                                </td>
                                <td className="px-4 py-3">
                                    <Skeleton aria-hidden className="h-4 w-28" />
                                </td>
                                <td className="px-4 py-3">
                                    <Skeleton aria-hidden className="h-4 w-32" />
                                </td>
                                <td className="px-4 py-3">
                                    <Skeleton aria-hidden className="h-4 w-10" />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
