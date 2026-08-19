import type { FxSessionSummary, FxWorkspaceGroup } from '@spiracha/lib/fx-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { FxSessionsTable } from '#/components/fx-sessions-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Button } from '#/components/ui/button';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { fxSessionsQueryOptions, fxWorkspacesQueryOptions } from '#/lib/fx-queries';
import { deleteFxSessionFn, deleteFxSessionsFn, exportFxSessionFn, exportFxSessionsFn } from '#/lib/fx-server';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

type PendingSessionDelete = { scope: 'all' | 'selected'; sessions: FxSessionSummary[] };
type PendingSessionExport = { label: string; sessionIds: string[] };

const findWorkspaceOrThrow = (workspaces: FxWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`FX workspace not found: ${workspaceKey}`);
    }
    return workspace;
};

const buildSessionExport = (sessions: FxSessionSummary[]): PendingSessionExport => ({
    label: sessions.length === 1 ? sessions[0]!.title : `${sessions.length} selected sessions`,
    sessionIds: sessions.map((session) => session.sessionId),
});

const getDeleteConfirmLabel = (pendingDelete: PendingSessionDelete | null, isPending: boolean) => {
    if (isPending) {
        return 'Deleting...';
    }
    if (pendingDelete?.scope === 'all') {
        return 'Delete all';
    }
    return pendingDelete && pendingDelete.sessions.length > 1 ? 'Delete sessions' : 'Delete session';
};

const getDeleteDescription = (pendingDelete: PendingSessionDelete | null) => {
    if (!pendingDelete) {
        return 'Permanently delete the selected FX sessions.';
    }
    const count = pendingDelete.sessions.length;
    const target =
        pendingDelete.scope === 'all'
            ? `all ${count} FX sessions in this workspace`
            : count === 1
              ? `"${pendingDelete.sessions[0]!.title}"`
              : `${count} selected FX sessions`;
    return `Permanently delete ${target}. This removes the session directories and their entries from FX session indexes and latest pointers. Workspace files and global FX history are preserved.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) => {
    if (pendingDelete?.scope === 'all') {
        return `Delete all ${pendingDelete.sessions.length} FX sessions?`;
    }
    return pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} FX sessions?`
        : 'Delete this FX session?';
};

const FxWorkspacePage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(fxWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, Route.useParams().workspaceKey);
    const sessions = useSuspenseQuery(fxSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingSessionDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingSessionExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);
    const visibleSessions = useMemo(
        () =>
            sessions.filter((session) =>
                matchesTextQuery(deferredSearch, [
                    session.title,
                    session.sessionId,
                    session.currentModelId,
                    session.currentModelVariant,
                    session.status,
                ]),
            ),
        [deferredSearch, sessions],
    );
    const visibleSessionsById = useMemo(
        () => new Map(visibleSessions.map((session) => [session.sessionId, session])),
        [visibleSessions],
    );

    const exportMutation = useMutation({
        mutationFn: async ({ ids, options }: ExportSelectionMutationInput) => {
            const data = {
                includeCommentary: options.includeCommentary,
                includeMetadata: options.includeMetadata,
                includeTools: options.includeTools,
                outputFormat: options.outputFormat,
                zipArchive: options.zipArchive,
            };
            const download =
                ids.length === 1
                    ? await exportFxSessionFn({ data: { ...data, sessionId: ids[0]! } })
                    : await exportFxSessionsFn({ data: { ...data, sessionIds: [...ids] } });
            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
                return;
            }
            await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl);
        },
        onSuccess: () => setPendingExport(null),
    });

    const deleteMutation = useMutation({
        mutationFn: async (sessionIds: string[]) =>
            sessionIds.length === 1
                ? deleteFxSessionFn({ data: { sessionId: sessionIds[0]! } })
                : deleteFxSessionsFn({ data: { sessionIds } }),
        onSettled: async (_result, _error, sessionIds) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['fx-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['fx-sessions', workspace.key] }),
                ...sessionIds.map((sessionId) =>
                    queryClient.invalidateQueries({ queryKey: ['fx-session', sessionId] }),
                ),
            ]);
        },
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/fx' });
            }
        },
    });

    const lookupSessions = (ids: string[]) =>
        ids
            .map((id) => visibleSessionsById.get(id) ?? null)
            .filter((value): value is FxSessionSummary => value !== null);
    const openExport = (selected: FxSessionSummary[]) =>
        selected.length > 0 && setPendingExport(buildSessionExport(selected));
    const openDelete = (selected: FxSessionSummary[], scope: PendingSessionDelete['scope']) =>
        selected.length > 0 && setPendingDelete({ scope, sessions: selected });

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                            className="rounded-full"
                            disabled={deleteMutation.isPending || sessions.length === 0}
                            type="button"
                            variant="destructive"
                            onClick={() => openDelete(sessions, 'all')}
                        >
                            <Trash2 className="size-4" /> Delete all
                        </Button>
                        <ListSearchInput
                            placeholder="Search title, model, status, or ID"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="FX workspace"
                subtitle={workspace.worktree}
                title={workspace.label}
            />
            <FxSessionsTable
                sessions={visibleSessions}
                onDeleteSession={(session) => openDelete([session], 'selected')}
                onDeleteSessions={(ids) => openDelete(lookupSessions(ids), 'selected')}
                onExportSession={(session) => openExport([session])}
                onExportSessions={(ids) => openExport(lookupSessions(ids))}
            />
            <ExportDialog
                focusedEvidenceTarget={
                    pendingExport?.sessionIds.length === 1
                        ? { id: pendingExport.sessionIds[0]!, source: 'fx' }
                        : undefined
                }
                errorMessage={exportMutation.isError ? (exportMutation.error as Error).message : null}
                forceZipArchive={pendingExport ? pendingExport.sessionIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                title={`Export ${pendingExport?.label ?? 'sessions'}`}
                onExport={(options) =>
                    pendingExport &&
                    exportMutation.mutate(createExportSelectionMutationInput(pendingExport.sessionIds, options))
                }
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingExport(null);
                        exportMutation.reset();
                    }
                }}
            />
            <DeleteConfirmDialog
                confirmLabel={getDeleteConfirmLabel(pendingDelete, deleteMutation.isPending)}
                description={getDeleteDescription(pendingDelete)}
                errorMessage={deleteMutation.isError ? (deleteMutation.error as Error).message : null}
                open={pendingDelete !== null}
                title={getDeleteTitle(pendingDelete)}
                onConfirm={() =>
                    pendingDelete && deleteMutation.mutate(pendingDelete.sessions.map((session) => session.sessionId))
                }
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDelete(null);
                        deleteMutation.reset();
                    }
                }}
            />
        </div>
    );
};

export const Route = createFileRoute('/fx/$workspaceKey')({
    component: FxWorkspacePage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load FX workspace" />,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(fxWorkspacesQueryOptions());
        const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(fxSessionsQueryOptions(workspace.key));
    },
    pendingComponent: () => (
        <LoadingPanel description="Loading FX sessions and transcript metadata." title="Loading workspace" />
    ),
});
