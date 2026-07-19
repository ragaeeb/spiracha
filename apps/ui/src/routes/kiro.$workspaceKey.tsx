import type { KiroSessionSummary, KiroWorkspaceGroup } from '@spiracha/lib/kiro-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { KiroSessionsTable } from '#/components/kiro-sessions-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Button } from '#/components/ui/button';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { kiroSessionsQueryOptions, kiroWorkspacesQueryOptions } from '#/lib/kiro-queries';
import {
    deleteKiroSessionFn,
    deleteKiroSessionsFn,
    exportKiroSessionFn,
    exportKiroSessionsFn,
} from '#/lib/kiro-server';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

type PendingSessionDelete = {
    scope: 'all' | 'selected';
    sessions: KiroSessionSummary[];
};

type PendingSessionExport = {
    label: string;
    sessionIds: string[];
};

const findWorkspaceOrThrow = (workspaces: KiroWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Kiro workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

const buildSessionExport = (selectedSessions: KiroSessionSummary[]): PendingSessionExport => ({
    label: selectedSessions.length === 1 ? selectedSessions[0]!.title : `${selectedSessions.length} selected sessions`,
    sessionIds: selectedSessions.map((session) => session.sessionId),
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
        return 'Permanently delete the selected Kiro sessions from disk.';
    }

    if (pendingDelete.scope === 'all') {
        return `Permanently delete all ${pendingDelete.sessions.length} Kiro sessions in this workspace from disk. This removes session JSON files and matching execution files.`;
    }

    if (pendingDelete.sessions.length === 1) {
        return `Permanently delete "${pendingDelete.sessions[0]!.title}" from Kiro history. This removes the session JSON file and matching execution files from disk.`;
    }

    return `Permanently delete ${pendingDelete.sessions.length} selected Kiro sessions from disk. This removes session JSON files and matching execution files.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) => {
    if (pendingDelete?.scope === 'all') {
        return `Delete all ${pendingDelete.sessions.length} Kiro sessions?`;
    }

    return pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} Kiro sessions?`
        : 'Delete this Kiro session?';
};

const KiroWorkspaceErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load Kiro workspace" />;
};

const KiroWorkspacePage = () => {
    const navigate = useNavigate({ from: Route.fullPath });
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(kiroWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(kiroSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingSessionDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingSessionExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async ({ ids, options }: ExportSelectionMutationInput) => {
            const download =
                ids.length === 1
                    ? await exportKiroSessionFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionId: ids[0]!,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportKiroSessionsFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionIds: [...ids],
                              zipArchive: options.zipArchive,
                          },
                      });
            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
                return;
            }

            await downloadUrlFile(download.fileName, download.downloadUrl);
        },
        onSuccess: () => {
            setPendingExport(null);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (sessionIds: string[]) =>
            sessionIds.length === 1
                ? deleteKiroSessionFn({ data: { sessionId: sessionIds[0]! } })
                : deleteKiroSessionsFn({ data: { sessionIds } }),
        onSettled: async (_result, _error, sessionIds) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['kiro-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['kiro-sessions', workspace.key] }),
                ...sessionIds.map((sessionId) =>
                    queryClient.invalidateQueries({ queryKey: ['kiro-session', sessionId] }),
                ),
            ]);
        },
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/kiro' });
            }
        },
    });

    const visibleSessions = useMemo(
        () =>
            sessions.filter((session) =>
                matchesTextQuery(deferredSearch, [
                    session.title,
                    session.sessionId,
                    session.selectedModel,
                    session.defaultModelTitle,
                    session.selectedProfileId,
                    session.sessionType,
                    session.filePath,
                ]),
            ),
        [deferredSearch, sessions],
    );
    const visibleSessionsById = useMemo(
        () => new Map(visibleSessions.map((session) => [session.sessionId, session])),
        [visibleSessions],
    );
    const lookupSelectedSessions = (sessionIds: string[]) =>
        sessionIds
            .map((sessionId) => visibleSessionsById.get(sessionId) ?? null)
            .filter((session): session is KiroSessionSummary => session !== null);
    const openExportForSessions = (selectedSessions: KiroSessionSummary[]) => {
        if (selectedSessions.length === 0) {
            return;
        }

        setPendingExport(buildSessionExport(selectedSessions));
    };
    const openDeleteForSessions = (selectedSessions: KiroSessionSummary[], scope: PendingSessionDelete['scope']) => {
        if (selectedSessions.length > 0) {
            setPendingDelete({ scope, sessions: selectedSessions });
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                            className="rounded-full"
                            disabled={deleteMutation.isPending || sessions.length === 0}
                            type="button"
                            variant="destructive"
                            onClick={() => openDeleteForSessions(sessions, 'all')}
                        >
                            <Trash2 className="size-4" />
                            Delete all
                        </Button>
                        <ListSearchInput
                            placeholder="Search session title, id, model, or type"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="Kiro workspace"
                subtitle="Inspect local Kiro sessions, user prompts, assistant responses, images, and prompt logs."
                title={workspace.label}
            />

            <KiroSessionsTable
                sessions={visibleSessions}
                onDeleteSession={(session) => openDeleteForSessions([session], 'selected')}
                onDeleteSessions={(sessionIds) => openDeleteForSessions(lookupSelectedSessions(sessionIds), 'selected')}
                onExportSession={(session) => openExportForSessions([session])}
                onExportSessions={(sessionIds) => openExportForSessions(lookupSelectedSessions(sessionIds))}
            />

            <ExportDialog
                errorMessage={
                    exportMutation.isError
                        ? exportMutation.error instanceof Error
                            ? exportMutation.error.message
                            : 'Session export failed'
                        : null
                }
                forceZipArchive={pendingExport ? pendingExport.sessionIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                title={pendingExport ? `Export ${pendingExport.label}` : 'Export session'}
                onExport={(options) => {
                    if (pendingExport) {
                        exportMutation.mutate(createExportSelectionMutationInput(pendingExport.sessionIds, options));
                    }
                }}
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
                errorMessage={
                    deleteMutation.isError
                        ? deleteMutation.error instanceof Error
                            ? deleteMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={pendingDelete !== null}
                title={getDeleteTitle(pendingDelete)}
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteMutation.mutate(pendingDelete.sessions.map((session) => session.sessionId));
                    }
                }}
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

export const Route = createFileRoute('/kiro/$workspaceKey')({
    component: KiroWorkspacePage,
    errorComponent: KiroWorkspaceErrorComponent,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(kiroWorkspacesQueryOptions());
        findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(kiroSessionsQueryOptions(params.workspaceKey));
    },
    pendingComponent: () => (
        <LoadingPanel description="Loading Kiro sessions and transcript metadata." title="Loading workspace" />
    ),
});
