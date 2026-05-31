import type { ThreadListEntry } from '@spiracha/lib/codex-browser-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { RefreshCcw } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
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
import { useSettings } from '#/lib/settings-store';
import { matchesTextQuery } from '#/lib/text-filter';

type PendingThreadDelete = {
    threads: ThreadListEntry[];
};

type PendingThreadExport = {
    threadIds: string[];
    threadLabel: string;
};

export const Route = createFileRoute('/projects/$project')({
    component: ProjectDetailPage,
    errorComponent: ProjectDetailErrorComponent,
    loader: ({ context, params }) => context.queryClient.ensureQueryData(projectThreadsQueryOptions(params.project)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading project threads and transcript summaries. Large projects can take a moment."
            title="Loading project"
        />
    ),
});

function ProjectDetailErrorComponent({ error }: { error: Error }) {
    const isSqlite = error.message.includes('unable to open database') || error.message.includes('database is locked');
    return (
        <ReloadErrorPanel
            description={
                isSqlite ? 'Codex may have an exclusive lock on the database. Reload to retry.' : error.message
            }
            title={isSqlite ? 'Database unavailable' : 'Failed to load Codex project'}
        />
    );
}

function ProjectDetailPage() {
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const threads = useSuspenseQuery(projectThreadsQueryOptions(params.project)).data;
    const { settings } = useSettings();
    const [searchInput, setSearchInput] = useState('');
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
                queryClient.invalidateQueries({ queryKey: ['project-threads', params.project] }),
                queryClient.invalidateQueries({ queryKey: ['projects'] }),
            ]);
            setPendingDelete(null);
        },
    });

    const recoverProjectMutation = useMutation({
        mutationFn: () =>
            recoverProjectThreadsFn({
                data: {
                    project: params.project,
                },
            }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['analytics'] }),
                queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
                queryClient.invalidateQueries({ queryKey: ['project-threads', params.project] }),
                queryClient.invalidateQueries({ queryKey: ['projects'] }),
            ]);
        },
    });

    const exportThreadMutation = useMutation({
        mutationFn: async (options: {
            includeCommentary: boolean;
            includeTools: boolean;
            includeMetadata: boolean;
            outputFormat: 'md' | 'txt';
        }) => {
            if (!pendingExport) {
                throw new Error('No thread selected for export');
            }

            console.info('[spiracha:export-ui] request', {
                outputFormat: options.outputFormat,
                project: params.project,
                selectedThreadCount: pendingExport.threadIds.length,
                selectedThreadIds: pendingExport.threadIds,
            });

            const download =
                pendingExport.threadIds.length === 1
                    ? await exportThreadFn({
                          data: {
                              ...options,
                              ...settings,
                              threadId: pendingExport.threadIds[0]!,
                          },
                      })
                    : await exportThreadsFn({
                          data: {
                              ...options,
                              ...settings,
                              threadIds: pendingExport.threadIds,
                          },
                      });

            console.info('[spiracha:export-ui] response', {
                downloadUrl: download.mode === 'download_url' ? download.downloadUrl : null,
                fileName: download.fileName,
                mode: download.mode,
                project: params.project,
                selectedThreadCount: pendingExport.threadIds.length,
            });

            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
                return;
            }

            await downloadUrlFile(download.fileName, download.downloadUrl);
        },
        onError: (error) => {
            console.error('[spiracha:export-ui] failed', {
                error: error instanceof Error ? error.message : String(error),
                project: params.project,
                selectedThreadCount: pendingExport?.threadIds.length ?? 0,
                selectedThreadIds: pendingExport?.threadIds ?? [],
            });
        },
        onSuccess: () => {
            setPendingExport(null);
        },
    });

    const visibleThreads = [...threads].filter((thread) => {
        return matchesTextQuery(deferredSearch, [
            thread.thread.title,
            thread.thread.preview,
            thread.thread.model,
            thread.thread.id,
        ]);
    });
    const visibleThreadsById = useMemo(
        () => new Map(visibleThreads.map((thread) => [thread.thread.id, thread])),
        [visibleThreads],
    );

    const lookupSelectedThreads = (threadIds: string[]) => {
        return threadIds
            .map((threadId) => visibleThreadsById.get(threadId) ?? null)
            .filter((thread): thread is ThreadListEntry => thread !== null);
    };

    return (
        <div className="space-y-6">
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
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="Codex project"
                subtitle="Sort by any column, inspect tool call volume, manage thread records, or repair stale Codex thread metadata for this derived project."
                title={params.project}
            />

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
                confirmLabel={
                    deleteThreadMutation.isPending
                        ? 'Deleting...'
                        : pendingDelete && pendingDelete.threads.length > 1
                          ? 'Delete threads'
                          : 'Delete thread'
                }
                defaultDeleteSessionFiles
                description={
                    pendingDelete
                        ? pendingDelete.threads.length === 1
                            ? `Delete the thread "${pendingDelete.threads[0]!.thread.title}" from the Codex database. Leave Session files unchecked if you only want to remove the current DB row.`
                            : `Delete ${pendingDelete.threads.length} selected threads from the Codex database. Enable Delete Session files if you also want to remove their rollout JSONL files.`
                        : ''
                }
                open={pendingDelete !== null}
                showDeleteSessionFilesOption
                title={
                    pendingDelete && pendingDelete.threads.length > 1
                        ? `Delete ${pendingDelete.threads.length} Codex threads?`
                        : 'Delete Codex thread?'
                }
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
                    }
                }}
            />

            <ExportDialog
                open={pendingExport !== null}
                pending={exportThreadMutation.isPending}
                title={pendingExport ? `Export ${pendingExport.threadLabel}` : 'Export thread'}
                onExport={(options) => exportThreadMutation.mutate(options)}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingExport(null);
                    }
                }}
            />
        </div>
    );
}
