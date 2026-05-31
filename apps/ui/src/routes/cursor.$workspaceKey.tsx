import type { CursorThreadSummary, CursorWorkspaceGroup } from '@spiracha/lib/cursor-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { RefreshCcw, Trash2 } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { CursorThreadsTable } from '#/components/cursor-threads-table';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { Button } from '#/components/ui/button';
import { cursorThreadsQueryOptions, cursorWorkspacesQueryOptions } from '#/lib/cursor-queries';
import {
    deleteCursorThreadsFn,
    deleteCursorWorkspaceFn,
    exportCursorThreadFn,
    exportCursorThreadsFn,
    recoverCursorWorkspaceFn,
} from '#/lib/cursor-server';
import { downloadTextFile } from '#/lib/download';
import { matchesTextQuery } from '#/lib/text-filter';

type PendingCursorDelete =
    | { kind: 'threads'; threads: CursorThreadSummary[] }
    | { kind: 'workspace'; workspace: CursorWorkspaceGroup };

type PendingCursorExport = {
    composerIds: string[];
    label: string;
};

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
};

const findWorkspaceOrThrow = (workspaces: CursorWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Cursor workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

const getSelectedThreads = (threads: CursorThreadSummary[], composerIds: string[]) => {
    const composerIdSet = new Set(composerIds);
    return threads.filter((thread) => composerIdSet.has(thread.composerId));
};

const buildPendingCursorDelete = (threads: CursorThreadSummary[]): PendingCursorDelete | null => {
    if (threads.length === 0) {
        return null;
    }

    return { kind: 'threads', threads };
};

const buildPendingCursorExport = (threads: CursorThreadSummary[]): PendingCursorExport | null => {
    if (threads.length === 0) {
        return null;
    }

    return {
        composerIds: threads.map((thread) => thread.composerId),
        label: threads.length === 1 ? threads[0]!.name : `${threads.length} selected threads`,
    };
};

const getCursorDeleteConfirmLabel = (pendingDelete: PendingCursorDelete | null, pending: boolean) => {
    if (pending) {
        return 'Deleting...';
    }

    if (pendingDelete?.kind === 'workspace') {
        return 'Delete workspace';
    }

    return pendingDelete && pendingDelete.threads.length > 1 ? 'Delete threads' : 'Delete thread';
};

const getCursorDeleteDescription = (pendingDelete: PendingCursorDelete | null) => {
    if (!pendingDelete) {
        return '';
    }

    if (pendingDelete.kind === 'workspace') {
        return `Permanently delete every thread for "${pendingDelete.workspace.label}" from Cursor's database and remove any on-disk transcript directories. Quit Cursor first. This cannot be undone.`;
    }

    if (pendingDelete.threads.length === 1) {
        return `Permanently delete "${pendingDelete.threads[0]!.name}" from Cursor's database and remove any on-disk transcript directories. Quit Cursor first. This cannot be undone.`;
    }

    return `Permanently delete ${pendingDelete.threads.length} selected Cursor threads and remove any on-disk transcript directories. Quit Cursor first. This cannot be undone.`;
};

const getCursorDeleteTitle = (pendingDelete: PendingCursorDelete | null) => {
    if (pendingDelete?.kind === 'workspace') {
        return 'Delete Cursor workspace?';
    }

    if (pendingDelete && pendingDelete.threads.length > 1) {
        return `Delete ${pendingDelete.threads.length} Cursor threads?`;
    }

    return 'Delete Cursor thread?';
};

const getCursorExportMimeType = (outputFormat: 'md' | 'txt') => {
    return outputFormat === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
};

export const Route = createFileRoute('/cursor/$workspaceKey')({
    component: CursorWorkspacePage,
    errorComponent: CursorWorkspaceErrorComponent,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(cursorWorkspacesQueryOptions());
        findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(cursorThreadsQueryOptions(params.workspaceKey));
    },
    pendingComponent: () => (
        <LoadingPanel
            description="Loading Cursor threads and workspace metadata. Larger workspaces can take a moment."
            title="Loading workspace"
        />
    ),
});

function CursorWorkspaceErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Cursor workspace" />;
}

function CursorWorkspacePage() {
    const navigate = useNavigate();
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(cursorWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const threads = useSuspenseQuery(cursorThreadsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingCursorDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingCursorExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const invalidateWorkspaceQueries = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['cursor-workspaces'] }),
            queryClient.invalidateQueries({ queryKey: ['cursor-threads', workspace.key] }),
        ]);
    };

    const recoverWorkspaceMutation = useMutation({
        mutationFn: () => recoverCursorWorkspaceFn({ data: { apply: true, workspaceKey: workspace.key } }),
        onSuccess: invalidateWorkspaceQueries,
    });

    const deleteMutation = useMutation({
        mutationFn: (target: PendingCursorDelete) =>
            target.kind === 'workspace'
                ? deleteCursorWorkspaceFn({ data: { workspaceKey: target.workspace.key } })
                : deleteCursorThreadsFn({ data: { composerIds: target.threads.map((thread) => thread.composerId) } }),
        onSuccess: async (_result, target) => {
            await invalidateWorkspaceQueries();
            setPendingDelete(null);
            if (target.kind === 'workspace') {
                await navigate({ to: '/cursor' });
            }
        },
    });

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No thread selected for export');
            }

            const download =
                pendingExport.composerIds.length === 1
                    ? await exportCursorThreadFn({
                          data: {
                              ...options,
                              composerId: pendingExport.composerIds[0]!,
                          },
                      })
                    : await exportCursorThreadsFn({
                          data: {
                              ...options,
                              composerIds: pendingExport.composerIds,
                          },
                      });

            downloadTextFile(download.filename, download.content, getCursorExportMimeType(options.outputFormat));
        },
        onSuccess: () => {
            setPendingExport(null);
        },
    });

    const visibleThreads = threads.filter((thread) =>
        matchesTextQuery(deferredSearch, [thread.name, thread.composerId, thread.mode, thread.workspaceLabel]),
    );
    const openDeleteForSelectedThreads = (composerIds: string[]) => {
        const nextPendingDelete = buildPendingCursorDelete(getSelectedThreads(visibleThreads, composerIds));
        if (nextPendingDelete) {
            setPendingDelete(nextPendingDelete);
        }
    };
    const openExportForSelectedThreads = (composerIds: string[]) => {
        const nextPendingExport = buildPendingCursorExport(getSelectedThreads(visibleThreads, composerIds));
        if (nextPendingExport) {
            setPendingExport(nextPendingExport);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <CursorWorkspaceHeaderActions
                        deletePending={deleteMutation.isPending}
                        recoverPending={recoverWorkspaceMutation.isPending}
                        searchInput={searchInput}
                        workspace={workspace}
                        onDeleteWorkspace={() => setPendingDelete({ kind: 'workspace', workspace })}
                        onRecoverWorkspace={() => recoverWorkspaceMutation.mutate()}
                        onSearchInputChange={setSearchInput}
                    />
                }
                eyebrow="Cursor workspace"
                subtitle="Sort by any column, export thread transcripts, delete stale records, or repair split storage buckets for this workspace."
                title={workspace.label}
            />

            <CursorWorkspaceRecoveryNotice workspace={workspace} />

            <CursorThreadsTable
                onDeleteThread={(thread) => setPendingDelete({ kind: 'threads', threads: [thread] })}
                onDeleteThreads={openDeleteForSelectedThreads}
                onExportThread={(thread) =>
                    setPendingExport({
                        composerIds: [thread.composerId],
                        label: thread.name,
                    })
                }
                onExportThreads={openExportForSelectedThreads}
                threads={visibleThreads}
            />

            <CursorWorkspaceErrors
                deleteError={deleteMutation.isError ? deleteMutation.error : null}
                exportError={exportMutation.isError ? exportMutation.error : null}
                recoverError={recoverWorkspaceMutation.isError ? recoverWorkspaceMutation.error : null}
            />

            <CursorWorkspaceDeleteDialog
                pending={deleteMutation.isPending}
                pendingDelete={pendingDelete}
                onConfirm={() => {
                    if (!pendingDelete) {
                        return;
                    }

                    deleteMutation.mutate(pendingDelete);
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDelete(null);
                    }
                }}
            />

            <ExportDialog
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                title={pendingExport ? `Export ${pendingExport.label}` : 'Export thread'}
                onExport={(options) => exportMutation.mutate(options)}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingExport(null);
                    }
                }}
            />
        </div>
    );
}

function CursorWorkspaceHeaderActions({
    deletePending,
    recoverPending,
    searchInput,
    workspace,
    onDeleteWorkspace,
    onRecoverWorkspace,
    onSearchInputChange,
}: {
    deletePending: boolean;
    recoverPending: boolean;
    searchInput: string;
    workspace: CursorWorkspaceGroup;
    onDeleteWorkspace: () => void;
    onRecoverWorkspace: () => void;
    onSearchInputChange: (value: string) => void;
}) {
    return (
        <div className="flex flex-col gap-2 sm:flex-row">
            {workspace.needsRecovery ? (
                <Button
                    className="rounded-full"
                    disabled={recoverPending}
                    type="button"
                    variant="outline"
                    onClick={onRecoverWorkspace}
                >
                    <RefreshCcw className="mr-2 size-4" />
                    {recoverPending ? 'Recovering...' : 'Recover'}
                </Button>
            ) : null}
            <Button
                className="rounded-full"
                disabled={deletePending}
                type="button"
                variant="outline"
                onClick={onDeleteWorkspace}
            >
                <Trash2 className="mr-2 size-4" />
                Delete workspace
            </Button>
            <ListSearchInput
                placeholder="Search thread name, id, or mode"
                value={searchInput}
                onValueChange={onSearchInputChange}
            />
        </div>
    );
}

function CursorWorkspaceRecoveryNotice({ workspace }: { workspace: CursorWorkspaceGroup }) {
    if (!workspace.needsRecovery) {
        return null;
    }

    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-4">
            <p className="font-medium text-sm">This workspace has threads in an older storage bucket.</p>
            <p className="mt-1 text-[var(--muted-foreground)] text-xs">
                Recover merges those threads into the active bucket Cursor reads now so they reappear in Chat History.
                Quit Cursor before running it.
            </p>
        </div>
    );
}

function CursorWorkspaceErrors({
    deleteError,
    exportError,
    recoverError,
}: {
    deleteError: Error | null;
    exportError: Error | null;
    recoverError: Error | null;
}) {
    const entries = [
        recoverError ? recoverError.message : null,
        deleteError ? deleteError.message : null,
        exportError ? exportError.message : null,
    ].filter(Boolean);

    if (entries.length === 0) {
        return null;
    }

    return (
        <div className="space-y-1">
            {entries.map((message) => (
                <p className="text-[var(--destructive)] text-sm" key={message}>
                    {message}
                </p>
            ))}
        </div>
    );
}

function CursorWorkspaceDeleteDialog({
    pending,
    pendingDelete,
    onConfirm,
    onOpenChange,
}: {
    pending: boolean;
    pendingDelete: PendingCursorDelete | null;
    onConfirm: () => void;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <DeleteConfirmDialog
            confirmLabel={getCursorDeleteConfirmLabel(pendingDelete, pending)}
            description={getCursorDeleteDescription(pendingDelete)}
            open={pendingDelete !== null}
            title={getCursorDeleteTitle(pendingDelete)}
            onConfirm={onConfirm}
            onOpenChange={onOpenChange}
        />
    );
}
