import type { ThreadListEntry } from '@spiracha/lib/codex-browser-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { RefreshCcw } from 'lucide-react';
import { startTransition, useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { ThreadsTable } from '#/components/threads-table';
import { Button } from '#/components/ui/button';
import { projectThreadsQueryOptions } from '#/lib/codex-queries';
import {
    deleteThreadFn,
    deleteThreadsFn,
    exportThreadFn,
    exportThreadsFn,
    recoverProjectThreadsFn,
} from '#/lib/codex-server';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import { parseTextQuerySearch, withTextQuerySearch } from '#/lib/route-search';
import { useSettings } from '#/lib/settings-store';
import { matchesTextQuery } from '#/lib/text-filter';

type PendingThreadDelete = {
    threads: ThreadListEntry[];
};

type PendingThreadExport = {
    threadIds: string[];
    threadLabel: string;
};

const shouldForceZipArchive = (pendingExport: PendingThreadExport | null) => {
    return Boolean(pendingExport && pendingExport.threadIds.length > 1);
};

const getDeleteConfirmLabel = (pendingDelete: PendingThreadDelete | null, isPending: boolean) => {
    if (isPending) {
        return 'Deleting...';
    }

    if (pendingDelete && pendingDelete.threads.length > 1) {
        return 'Delete threads';
    }

    return 'Delete thread';
};

const getDeleteDescription = (pendingDelete: PendingThreadDelete | null) => {
    if (!pendingDelete) {
        return '';
    }

    if (pendingDelete.threads.length === 1) {
        return `Delete the thread "${pendingDelete.threads[0]!.thread.title}" from the Codex database. Leave Session files unchecked if you only want to remove the current DB row.`;
    }

    return `Delete ${pendingDelete.threads.length} selected threads from the Codex database. Enable Delete Session files if you also want to remove their rollout JSONL files.`;
};

const getDeleteTitle = (pendingDelete: PendingThreadDelete | null) => {
    if (pendingDelete && pendingDelete.threads.length > 1) {
        return `Delete ${pendingDelete.threads.length} Codex threads?`;
    }

    return 'Delete Codex thread?';
};

const decodeProjectParam = (project: string) => {
    try {
        return decodeURIComponent(project);
    } catch {
        return project;
    }
};

export const Route = createFileRoute('/codex/$project')({
    component: ProjectDetailPage,
    errorComponent: ProjectDetailErrorComponent,
    validateSearch: parseTextQuerySearch,
});

function ProjectDetailErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Codex project" />;
}

function ProjectThreadsLoadingState({ project }: { project: string }) {
    return (
        <div aria-busy="true" aria-live="polite" className="space-y-6">
            <PageHeader
                eyebrow="Codex project"
                subtitle="Loading project threads. Large local histories can take a moment."
                title={project}
            />
            <div role="status">
                <LoadingPanel description="Reading thread rows and rollout metadata." title="Loading threads" />
            </div>
        </div>
    );
}

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

const getThreadExportErrorMessage = (error: unknown): string | null => {
    if (!error) {
        return null;
    }

    return error instanceof Error ? error.message : 'Thread export failed';
};

function ProjectDetailPage() {
    const navigate = useNavigate({ from: Route.fullPath });
    const params = Route.useParams();
    const project = useMemo(() => decodeProjectParam(params.project), [params.project]);
    const queryClient = useQueryClient();
    const threadsQuery = useQuery(projectThreadsQueryOptions(project));
    const threads = threadsQuery.data ?? [];
    const { settings } = useSettings();
    const search = Route.useSearch();
    const searchInput = search.q ?? '';
    const [pendingDelete, setPendingDelete] = useState<PendingThreadDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingThreadExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());

    const deleteThreadMutation = useMutation({
        mutationFn: (input: { deleteSessionFiles: boolean; threadIds: string[] }) => {
            if (input.threadIds.length === 1) {
                return deleteThreadFn({
                    data: {
                        deleteSessionFiles: input.deleteSessionFiles,
                        threadId: input.threadIds[0]!,
                    },
                });
            }

            return deleteThreadsFn({ data: input });
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['analytics'] }),
                queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
                queryClient.invalidateQueries({ queryKey: ['project-threads', project] }),
                queryClient.invalidateQueries({ queryKey: ['projects'] }),
            ]);
            setPendingDelete(null);
        },
    });

    const recoverProjectMutation = useMutation({
        mutationFn: () =>
            recoverProjectThreadsFn({
                data: {
                    project,
                },
            }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['analytics'] }),
                queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
                queryClient.invalidateQueries({ queryKey: ['project-threads', project] }),
                queryClient.invalidateQueries({ queryKey: ['projects'] }),
            ]);
        },
    });

    const exportThreadMutation = useMutation({
        mutationFn: async ({ ids, options }: ExportSelectionMutationInput) => {
            console.info('[spiracha:export-ui] request', {
                outputFormat: options.outputFormat,
                project,
                selectedThreadCount: ids.length,
                selectedThreadIds: ids,
                zipArchive: options.zipArchive,
            });

            const download =
                ids.length === 1
                    ? await exportThreadFn({
                          data: {
                              ...options,
                              ...settings,
                              threadId: ids[0]!,
                          },
                      })
                    : await exportThreadsFn({
                          data: {
                              ...options,
                              ...settings,
                              threadIds: [...ids],
                          },
                      });

            console.info('[spiracha:export-ui] response', {
                downloadUrl: download.mode === 'download_url' ? download.downloadUrl : null,
                fileName: download.fileName,
                mode: download.mode,
                project,
                selectedThreadCount: ids.length,
            });

            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
                return;
            }

            await downloadUrlFile(download.fileName, download.downloadUrl);
        },
        onError: (error, variables) => {
            console.error('[spiracha:export-ui] failed', {
                error: error instanceof Error ? error.message : String(error),
                project,
                selectedThreadCount: variables.ids.length,
                selectedThreadIds: variables.ids,
            });
        },
        onSuccess: () => {
            setPendingExport(null);
        },
    });

    const visibleThreads = useMemo(
        () =>
            threads.filter((thread) => {
                return matchesTextQuery(deferredSearch, [
                    thread.thread.title,
                    thread.thread.preview,
                    thread.thread.model,
                    thread.thread.id,
                ]);
            }),
        [deferredSearch, threads],
    );
    const visibleThreadsById = useMemo(
        () => new Map(visibleThreads.map((thread) => [thread.thread.id, thread])),
        [visibleThreads],
    );
    const updateSearchInput = (value: string) => {
        startTransition(() => {
            void navigate({
                params: true,
                replace: true,
                search: (previous: Record<string, unknown>) => withTextQuerySearch(previous, value),
            });
        });
    };

    const lookupSelectedThreads = (threadIds: string[]) => {
        return threadIds
            .map((threadId) => visibleThreadsById.get(threadId) ?? null)
            .filter((thread): thread is ThreadListEntry => thread !== null);
    };

    if (threadsQuery.isLoading) {
        return <ProjectThreadsLoadingState project={project} />;
    }

    if (threadsQuery.isError) {
        return <ProjectDetailErrorComponent error={toError(threadsQuery.error)} />;
    }

    return (
        <div aria-busy={threadsQuery.isFetching || undefined} className="space-y-6">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                            className="rounded-full"
                            disabled={recoverProjectMutation.isPending}
                            type="button"
                            variant="outline"
                            onClick={() => recoverProjectMutation.mutate()}
                        >
                            <RefreshCcw className="mr-2 size-4" />
                            {recoverProjectMutation.isPending ? 'Recovering...' : 'Recover'}
                        </Button>
                        <ListSearchInput
                            placeholder="Search thread title, preview, or model"
                            value={searchInput}
                            onValueChange={updateSearchInput}
                        />
                    </div>
                }
                eyebrow="Codex project"
                subtitle="Sort by any column, inspect tool call volume, manage thread records, or repair stale Codex thread metadata for this derived project."
                title={project}
            />

            {threadsQuery.isFetching && !threadsQuery.isLoading ? (
                <p role="status" className="text-[var(--muted-foreground)] text-sm">
                    Refreshing project threads...
                </p>
            ) : null}

            {recoverProjectMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {recoverProjectMutation.error instanceof Error
                        ? recoverProjectMutation.error.message
                        : 'Project recovery failed'}
                </p>
            ) : null}

            {recoverProjectMutation.isSuccess ? (
                <p className="text-[var(--success)] text-sm">Project thread metadata recovery completed.</p>
            ) : null}

            <ThreadsTable
                threads={visibleThreads}
                onDeleteThread={(thread) => setPendingDelete({ threads: [thread] })}
                onDeleteThreads={(threadIds) => {
                    const selectedThreads = lookupSelectedThreads(threadIds);
                    if (selectedThreads.length === 0) {
                        return;
                    }

                    setPendingDelete({ threads: selectedThreads });
                }}
                onExportThread={(thread) =>
                    setPendingExport({
                        threadIds: [thread.thread.id],
                        threadLabel: thread.thread.title,
                    })
                }
                onExportThreads={(threadIds) => {
                    const selectedThreads = lookupSelectedThreads(threadIds);
                    if (selectedThreads.length === 0) {
                        return;
                    }

                    setPendingExport({
                        threadIds: selectedThreads.map((thread) => thread.thread.id),
                        threadLabel:
                            selectedThreads.length === 1
                                ? selectedThreads[0]!.thread.title
                                : `${selectedThreads.length} selected threads`,
                    });
                }}
            />

            <DeleteConfirmDialog
                confirmLabel={getDeleteConfirmLabel(pendingDelete, deleteThreadMutation.isPending)}
                defaultDeleteSessionFiles
                description={getDeleteDescription(pendingDelete)}
                errorMessage={getMutationErrorMessage(deleteThreadMutation.error, 'Thread delete failed')}
                open={pendingDelete !== null}
                showDeleteSessionFilesOption
                title={getDeleteTitle(pendingDelete)}
                onConfirm={({ deleteSessionFiles }) => {
                    if (!pendingDelete) {
                        return;
                    }
                    deleteThreadMutation.mutate({
                        deleteSessionFiles,
                        threadIds: pendingDelete.threads.map((thread) => thread.thread.id),
                    });
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDelete(null);
                        deleteThreadMutation.reset();
                    }
                }}
            />

            <ExportDialog
                errorMessage={getThreadExportErrorMessage(exportThreadMutation.error)}
                forceZipArchive={shouldForceZipArchive(pendingExport)}
                open={pendingExport !== null}
                pending={exportThreadMutation.isPending}
                title={pendingExport ? `Export ${pendingExport.threadLabel}` : 'Export thread'}
                onExport={(options) => {
                    if (pendingExport) {
                        exportThreadMutation.mutate(
                            createExportSelectionMutationInput(pendingExport.threadIds, options),
                        );
                    }
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingExport(null);
                        exportThreadMutation.reset();
                    }
                }}
            />
        </div>
    );
}
