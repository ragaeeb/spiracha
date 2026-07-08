import type { KiroSessionSummary, KiroWorkspaceGroup } from '@spiracha/lib/kiro-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { KiroSessionsTable } from '#/components/kiro-sessions-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { kiroSessionsQueryOptions, kiroWorkspacesQueryOptions } from '#/lib/kiro-queries';
import {
    deleteKiroSessionFn,
    deleteKiroSessionsFn,
    exportKiroSessionFn,
    exportKiroSessionsFn,
} from '#/lib/kiro-server';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

type PendingSessionDelete = {
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

    return pendingDelete && pendingDelete.sessions.length > 1 ? 'Delete sessions' : 'Delete session';
};

const getDeleteDescription = (pendingDelete: PendingSessionDelete | null) => {
    if (!pendingDelete) {
        return 'Permanently delete the selected Kiro sessions from disk.';
    }

    if (pendingDelete.sessions.length === 1) {
        return `Permanently delete "${pendingDelete.sessions[0]!.title}" from Kiro history. This removes the session JSON file and matching execution files from disk.`;
    }

    return `Permanently delete ${pendingDelete.sessions.length} selected Kiro sessions from disk. This removes session JSON files and matching execution files.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) =>
    pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} Kiro sessions?`
        : 'Delete this Kiro session?';

const KiroWorkspaceErrorComponent = ({ error }: { error: Error }) => {
    return <ReloadErrorPanel description={error.message} title="Failed to load Kiro workspace" />;
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
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No Kiro session selected for export');
            }

            const download =
                pendingExport.sessionIds.length === 1
                    ? await exportKiroSessionFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionId: pendingExport.sessionIds[0]!,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportKiroSessionsFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionIds: pendingExport.sessionIds,
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
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/kiro' });
            }

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['kiro-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['kiro-sessions', workspace.key] }),
                ...sessionIds.map((sessionId) =>
                    queryClient.invalidateQueries({ queryKey: ['kiro-session', sessionId] }),
                ),
            ]);
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
    const openDeleteForSessions = (selectedSessions: KiroSessionSummary[]) => {
        if (selectedSessions.length > 0) {
            setPendingDelete({ sessions: selectedSessions });
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search session title, id, model, or type"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Kiro workspace"
                subtitle="Inspect local Kiro sessions, user prompts, assistant responses, images, and prompt logs."
                title={workspace.label}
            />

            <KiroSessionsTable
                sessions={visibleSessions}
                onDeleteSession={(session) => openDeleteForSessions([session])}
                onDeleteSessions={(sessionIds) => openDeleteForSessions(lookupSelectedSessions(sessionIds))}
                onExportSession={(session) => openExportForSessions([session])}
                onExportSessions={(sessionIds) => openExportForSessions(lookupSelectedSessions(sessionIds))}
            />

            <ExportDialog
                forceZipArchive={pendingExport ? pendingExport.sessionIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                title={pendingExport ? `Export ${pendingExport.label}` : 'Export session'}
                onExport={(options) => exportMutation.mutate(options)}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingExport(null);
                        exportMutation.reset();
                    }
                }}
            />

            {exportMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {exportMutation.error instanceof Error ? exportMutation.error.message : 'Session export failed'}
                </p>
            ) : null}

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
