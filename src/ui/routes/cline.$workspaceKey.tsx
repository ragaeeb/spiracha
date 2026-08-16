import type { ClineTaskSummary, ClineWorkspaceGroup } from '@spiracha/lib/cline-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { ClineTasksTable } from '#/components/cline-tasks-table';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Button } from '#/components/ui/button';
import { clineTasksQueryOptions, clineWorkspacesQueryOptions } from '#/lib/cline-queries';
import { deleteClineTaskFn, deleteClineTasksFn, exportClineTaskFn, exportClineTasksFn } from '#/lib/cline-server';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

const findWorkspace = (workspaces: ClineWorkspaceGroup[], key: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === key);
    if (!workspace) {
        throw new Error(`Cline workspace not found: ${key}`);
    }
    return workspace;
};

const ClineWorkspacePage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(clineWorkspacesQueryOptions()).data;
    const workspace = findWorkspace(workspaces, Route.useParams().workspaceKey);
    const tasks = useSuspenseQuery(clineTasksQueryOptions(workspace.key)).data;
    const [search, setSearch] = useState('');
    const [deleteTasks, setDeleteTasks] = useState<ClineTaskSummary[]>([]);
    const [exportTasks, setExportTasks] = useState<ClineTaskSummary[]>([]);
    const deferredSearch = useDeferredValue(search);
    const visible = useMemo(
        () =>
            tasks.filter((task) =>
                matchesTextQuery(deferredSearch, [task.title, task.taskId, task.modelId, task.ulid]),
            ),
        [deferredSearch, tasks],
    );
    const visibleById = useMemo(() => new Map(visible.map((task) => [task.taskId, task])), [visible]);
    const selected = (ids: string[]) => ids.flatMap((id) => visibleById.get(id) ?? []);

    const exportMutation = useMutation({
        mutationFn: async ({ ids, options }: ExportSelectionMutationInput) => {
            const download =
                ids.length === 1
                    ? await exportClineTaskFn({
                          data: { ...options, taskId: ids[0]!, zipArchive: options.zipArchive },
                      })
                    : await exportClineTasksFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              taskIds: [...ids],
                          },
                      });
            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
            } else {
                await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl);
            }
        },
        onSuccess: () => setExportTasks([]),
    });
    const deleteMutation = useMutation({
        mutationFn: async (ids: string[]) =>
            ids.length === 1
                ? deleteClineTaskFn({ data: { taskId: ids[0]! } })
                : deleteClineTasksFn({ data: { taskIds: ids } }),
        onSettled: async (_result, _error, ids) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['cline-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['cline-tasks', workspace.key] }),
                ...ids.map((id) => queryClient.invalidateQueries({ queryKey: ['cline-task', id] })),
            ]);
        },
        onSuccess: async (_result, ids) => {
            setDeleteTasks([]);
            if (isWorkspaceEmptiedByDelete(tasks, ids, (task) => task.taskId)) {
                await navigate({ to: '/cline' });
            }
        },
    });

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                            className="rounded-full"
                            disabled={tasks.length === 0}
                            type="button"
                            variant="destructive"
                            onClick={() => setDeleteTasks(tasks)}
                        >
                            <Trash2 className="size-4" /> Delete all
                        </Button>
                        <ListSearchInput
                            placeholder="Search title, model, or ID"
                            value={search}
                            onValueChange={setSearch}
                        />
                    </div>
                }
                eyebrow="Cline workspace"
                subtitle={workspace.worktree}
                title={workspace.label}
            />
            <ClineTasksTable
                sessions={visible}
                onDeleteSession={(task) => setDeleteTasks([task])}
                onDeleteSessions={(ids) => setDeleteTasks(selected(ids))}
                onExportSession={(task) => setExportTasks([task])}
                onExportSessions={(ids) => setExportTasks(selected(ids))}
            />
            <ExportDialog
                focusedEvidenceTarget={
                    exportTasks.length === 1 ? { id: exportTasks[0]!.taskId, source: 'cline' } : undefined
                }
                errorMessage={exportMutation.isError ? exportMutation.error.message : null}
                forceZipArchive={exportTasks.length > 1}
                open={exportTasks.length > 0}
                pending={exportMutation.isPending}
                title={`Export ${exportTasks.length === 1 ? exportTasks[0]!.title : `${exportTasks.length} chats`}`}
                onExport={(options) =>
                    exportMutation.mutate(
                        createExportSelectionMutationInput(
                            exportTasks.map((task) => task.taskId),
                            options,
                        ),
                    )
                }
                onOpenChange={(open) => !open && setExportTasks([])}
            />
            <DeleteConfirmDialog
                confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                description={`Permanently delete ${deleteTasks.length === 1 ? `"${deleteTasks[0]!.title}"` : `${deleteTasks.length} Cline chats`}. This updates Cline task history and removes the selected task directories.`}
                errorMessage={deleteMutation.isError ? deleteMutation.error.message : null}
                open={deleteTasks.length > 0}
                title={
                    deleteTasks.length === 1 ? 'Delete this Cline chat?' : `Delete ${deleteTasks.length} Cline chats?`
                }
                onConfirm={() => deleteMutation.mutate(deleteTasks.map((task) => task.taskId))}
                onOpenChange={(open) => !open && setDeleteTasks([])}
            />
        </div>
    );
};

export const Route = createFileRoute('/cline/$workspaceKey')({
    component: ClineWorkspacePage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Cline workspace" />,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(clineWorkspacesQueryOptions());
        await context.queryClient.ensureQueryData(
            clineTasksQueryOptions(findWorkspace(workspaces, params.workspaceKey).key),
        );
    },
    pendingComponent: () => <LoadingPanel description="Loading Cline chats." title="Loading workspace" />,
});
