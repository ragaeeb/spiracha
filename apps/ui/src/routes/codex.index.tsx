import type { ProjectSummary } from '@spiracha/lib/codex-browser-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { startTransition, useDeferredValue, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { PageHeader } from '#/components/page-header';
import { ProjectsLoadingState } from '#/components/projects-loading-state';
import { ProjectsTable } from '#/components/projects-table';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { projectsQueryOptions } from '#/lib/codex-queries';
import { deleteProjectFn } from '#/lib/codex-server';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import { parseTextQuerySearch, withTextQuerySearch } from '#/lib/route-search';
import { matchesTextQuery } from '#/lib/text-filter';

export const Route = createFileRoute('/codex/')({
    component: ProjectsPage,
    errorComponent: ProjectsErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(projectsQueryOptions()),
    pendingComponent: ProjectsLoadingState,
    validateSearch: parseTextQuerySearch,
});

function ProjectsErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Codex inventory" />;
}

function ProjectsPage() {
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const projects = useSuspenseQuery(projectsQueryOptions()).data;
    const search = Route.useSearch();
    const searchInput = search.q ?? '';
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
        return matchesTextQuery(deferredSearch, [
            project.name,
            project.cwdPaths.join('\n'),
            project.modelNames.join('\n'),
        ]);
    });

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search project name, cwd, or model"
                        value={searchInput}
                        onValueChange={(value) => {
                            startTransition(() => {
                                void navigate({
                                    replace: true,
                                    search: (previous: Record<string, unknown>) => withTextQuerySearch(previous, value),
                                });
                            });
                        }}
                    />
                }
                eyebrow="Inventory"
                subtitle="Derived projects are grouped from the final basename of each thread cwd, matching the existing CLI behavior."
                title="Codex"
            />

            <ProjectsTable projects={visibleProjects} onDeleteProject={setPendingDelete} />

            <DeleteConfirmDialog
                confirmLabel={deleteProjectMutation.isPending ? 'Deleting...' : 'Delete project'}
                description={
                    pendingDelete
                        ? `Delete ${pendingDelete.threadCount} thread records for the derived project "${pendingDelete.name}" from the Codex database. Enable Delete Session files to remove the rollout JSONL files too.`
                        : ''
                }
                errorMessage={getMutationErrorMessage(deleteProjectMutation.error, 'Project delete failed')}
                open={pendingDelete !== null}
                showDeleteSessionFilesOption
                title="Delete Codex project?"
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
                        deleteProjectMutation.reset();
                    }
                }}
            />
        </div>
    );
}
