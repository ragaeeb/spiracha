import type { ProjectSummary } from '@spiracha/lib/codex-browser-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { startTransition, useDeferredValue, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { PageHeader } from '#/components/page-header';
import { ProjectsTable } from '#/components/projects-table';
import { Input } from '#/components/ui/input';
import { projectsQueryOptions } from '#/lib/codex-queries';
import { deleteProjectFn } from '#/lib/codex-server';

export const Route = createFileRoute('/projects/')({
    component: ProjectsPage,
    errorComponent: ProjectsErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(projectsQueryOptions()),
});

function ProjectsErrorComponent({ error }: { error: Error }) {
    const isSqlite = error.message.includes('unable to open database') || error.message.includes('database is locked');
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-6 py-10 text-center">
            <p className="font-medium text-[var(--destructive)] text-sm">
                {isSqlite ? 'Database unavailable' : 'Failed to load projects'}
            </p>
            <p className="mt-2 text-[var(--muted-foreground)] text-sm">
                {isSqlite ? 'Codex may have an exclusive lock on the database. Reload to retry.' : error.message}
            </p>
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

function ProjectsPage() {
    const queryClient = useQueryClient();
    const projects = useSuspenseQuery(projectsQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
    const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());

    const deleteProjectMutation = useMutation({
        mutationFn: (input: { deleteSessionFiles: boolean; project: string }) => deleteProjectFn({ data: input }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['analytics'] }),
                queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
                queryClient.invalidateQueries({ queryKey: ['projects'] }),
            ]);
            setPendingDelete(null);
        },
    });

    const visibleProjects = projects.filter((project) => {
        if (!deferredSearch) {
            return true;
        }

        return project.name.toLowerCase().includes(deferredSearch);
    });

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <Input
                        className="h-10 w-full rounded-full border-[var(--border)] bg-[var(--panel)] px-4 sm:w-[20rem]"
                        placeholder="Search projects by name"
                        value={searchInput}
                        onChange={(event) => {
                            startTransition(() => {
                                setSearchInput(event.target.value);
                            });
                        }}
                    />
                }
                eyebrow="Inventory"
                subtitle="Derived projects are grouped from the final basename of each thread cwd, matching the existing CLI behavior."
                title="Projects"
            />

            <ProjectsTable projects={visibleProjects} onDeleteProject={setPendingDelete} />

            <DeleteConfirmDialog
                confirmLabel={deleteProjectMutation.isPending ? 'Deleting...' : 'Delete project'}
                description={
                    pendingDelete
                        ? `Delete ${pendingDelete.threadCount} thread records for the derived project "${pendingDelete.name}" from the Codex database. Enable Delete Session files to remove the rollout JSONL files too.`
                        : ''
                }
                open={pendingDelete !== null}
                showDeleteSessionFilesOption
                title="Delete project from Codex DB?"
                onConfirm={({ deleteSessionFiles }) => {
                    if (!pendingDelete) {
                        return;
                    }
                    deleteProjectMutation.mutate({
                        deleteSessionFiles,
                        project: pendingDelete.name,
                    });
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDelete(null);
                    }
                }}
            />
        </div>
    );
}
