import type { CodexCloudTask } from '@spiracha/lib/codex-cloud';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { startTransition, useDeferredValue, useMemo, useState } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { CodexCloudReadOnlyNotice, CodexCloudTasksTable } from '#/components/codex-cloud-tasks-table';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Button } from '#/components/ui/button';
import { codexCloudProjectQueryOptions } from '#/lib/codex-cloud-queries';
import { exportCodexCloudTaskFn, exportCodexCloudTasksFn } from '#/lib/codex-cloud-server';
import { conversationListSelection, lookupSelectedItems } from '#/lib/conversation-selection';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import { parseTextQuerySearch, withTextQuerySearch } from '#/lib/route-search';
import { matchesTextQuery } from '#/lib/text-filter';

export const Route = createFileRoute('/codex/cloud/projects/$environmentId')({
    component: CodexCloudProjectPage,
    errorComponent: CodexCloudProjectErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(codexCloudProjectQueryOptions(params.environmentId)),
    pendingComponent: () => (
        <LoadingPanel description="Loading the read-only Cloud task list." title="Loading Cloud project" />
    ),
    validateSearch: parseTextQuerySearch,
});

function CodexCloudProjectErrorComponent({ error }: { error: unknown }) {
    return <RouteErrorPanel error={error} title="Failed to load Codex Cloud project" />;
}

type PendingCloudExport = {
    label: string;
    taskIds: string[];
};

const buildCloudExport = (tasks: CodexCloudTask[]): PendingCloudExport | null =>
    tasks.length === 0
        ? null
        : {
              label: tasks.length === 1 ? tasks[0]!.title : `${tasks.length} selected threads`,
              taskIds: tasks.map((task) => task.id),
          };

const lookupVisibleCloudTasks = (tasks: CodexCloudTask[], taskIds: string[]) =>
    lookupSelectedItems(taskIds, tasks, (task) => task.id);

const downloadCloudExport = async (
    ids: readonly string[],
    options: ExportSelectionMutationInput['options'],
    cancellation: ReturnType<typeof useDownloadCancellation>,
) => {
    const payload = {
        includeCommentary: options.includeCommentary,
        includeMetadata: options.includeMetadata,
        includeTools: options.includeTools,
        outputFormat: options.outputFormat,
        zipArchive: options.zipArchive,
    };
    const download =
        ids.length === 1
            ? await exportCodexCloudTaskFn({ data: { ...payload, taskId: ids[0]! } })
            : await exportCodexCloudTasksFn({ data: { ...payload, taskIds: [...ids] } });
    if (download.mode === 'download') {
        downloadTextFile(download.fileName, download.content, download.mimeType);
        return;
    }
    await downloadUrlFileWithCancellation(cancellation, download.fileName, download.downloadUrl);
};

function CodexCloudProjectPage() {
    const navigate = Route.useNavigate();
    const { environmentId } = Route.useParams();
    const search = Route.useSearch();
    const project = useSuspenseQuery(codexCloudProjectQueryOptions(environmentId)).data;
    const searchInput = search.q ?? '';
    const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
    const visibleTasks = useMemo(
        () => project.tasks.filter((task) => matchesTextQuery(deferredSearch, [task.title, task.id, task.status])),
        [deferredSearch, project.tasks],
    );
    const [pendingExport, setPendingExport] = useState<PendingCloudExport | null>(null);
    const downloadCancellation = useDownloadCancellation();
    const exportMutation = useMutation({
        mutationFn: ({ ids, options }: ExportSelectionMutationInput) =>
            downloadCloudExport(ids, options, downloadCancellation),
        onSuccess: () => setPendingExport(null),
    });
    const openExport = (tasks: CodexCloudTask[]) => {
        const pending = buildCloudExport(tasks);
        if (pending) {
            setPendingExport(pending);
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button asChild className="rounded-full" variant="outline">
                            <Link to="/codex/cloud">
                                <ArrowLeft className="mr-2 size-4" />
                                Cloud projects
                            </Link>
                        </Button>
                        <ListSearchInput
                            placeholder="Search Cloud thread title, id, or state"
                            value={searchInput}
                            onValueChange={(value) => {
                                startTransition(() => {
                                    void navigate({
                                        replace: true,
                                        search: (previous) => withTextQuerySearch(previous, value),
                                    });
                                });
                            }}
                        />
                    </div>
                }
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'Codex', to: '/codex' },
                            { label: 'Cloud', to: '/codex/cloud' },
                            { label: project.label, truncate: true },
                        ]}
                    />
                }
                eyebrow="Codex Cloud project"
                subtitle={`${project.taskCount} current task${project.taskCount === 1 ? '' : 's'} · read-only Cloud history`}
                title={project.label}
            />

            <CodexCloudReadOnlyNotice />

            {project.partial ? (
                <p className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[var(--muted-foreground)] text-sm">
                    This project is from a bounded Cloud inventory. Some older current tasks may be outside the loaded
                    window.
                </p>
            ) : null}

            <CodexCloudTasksTable
                {...conversationListSelection(
                    'codex-cloud',
                    project.tasks.map((task) => task.id),
                    environmentId,
                )}
                emptyMessage="No Cloud threads match the current search."
                tasks={visibleTasks}
                onExportTask={(task) => openExport([task])}
                onExportTasks={(taskIds) => openExport(lookupVisibleCloudTasks(project.tasks, taskIds))}
            />
            <ExportDialog
                errorMessage={getMutationErrorMessage(exportMutation.error, 'Cloud thread export failed')}
                forceZipArchive={pendingExport ? pendingExport.taskIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                title={pendingExport ? `Export ${pendingExport.label}` : 'Export Cloud threads'}
                onExport={(options) => {
                    if (pendingExport) {
                        exportMutation.mutate(createExportSelectionMutationInput(pendingExport.taskIds, options));
                    }
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingExport(null);
                        exportMutation.reset();
                    }
                }}
            />
        </div>
    );
}
