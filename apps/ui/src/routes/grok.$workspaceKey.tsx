import type { GrokSessionSummary, GrokWorkspaceGroup } from '@spiracha/lib/grok-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { GrokSessionsTable } from '#/components/grok-sessions-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { grokSessionsQueryOptions, grokWorkspacesQueryOptions } from '#/lib/grok-queries';
import {
    deleteGrokSessionFn,
    deleteGrokSessionsFn,
    exportGrokSessionFn,
    exportGrokSessionsFn,
} from '#/lib/grok-server';
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
    sessions: GrokSessionSummary[];
};

type PendingSessionExport = {
    label: string;
    sessionIds: string[];
};

const findWorkspaceOrThrow = (workspaces: GrokWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Grok workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

const buildSessionExport = (selectedSessions: GrokSessionSummary[]): PendingSessionExport => ({
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
        return 'Permanently delete the selected Grok sessions from local history.';
    }

    if (pendingDelete.sessions.length === 1) {
        return `Permanently delete "${pendingDelete.sessions[0]!.title}" from Grok history. This removes the session directory and transcript files under ~/.grok/sessions.`;
    }

    return `Permanently delete ${pendingDelete.sessions.length} selected Grok sessions from local history. This removes their session directories and transcript files under ~/.grok/sessions.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) =>
    pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} Grok sessions?`
        : 'Delete this Grok session?';

export const Route = createFileRoute('/grok/$workspaceKey')({
    component: GrokWorkspacePage,
    errorComponent: GrokWorkspaceErrorComponent,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(grokWorkspacesQueryOptions());
        findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(grokSessionsQueryOptions(params.workspaceKey));
    },
    pendingComponent: () => <LoadingPanel description="Loading Grok sessions." title="Loading workspace" />,
});

function GrokWorkspaceErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Grok workspace" />;
}

function GrokWorkspacePage() {
    const navigate = useNavigate({ from: Route.fullPath });
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(grokWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(grokSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingSessionDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingSessionExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No Grok session selected for export');
            }

            const download =
                pendingExport.sessionIds.length === 1
                    ? await exportGrokSessionFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionId: pendingExport.sessionIds[0]!,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportGrokSessionsFn({
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
                ? deleteGrokSessionFn({ data: { sessionId: sessionIds[0]! } })
                : deleteGrokSessionsFn({ data: { sessionIds } }),
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/grok' });
            }

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['grok-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['grok-sessions', workspace.key] }),
                ...sessionIds.map((sessionId) =>
                    queryClient.invalidateQueries({ queryKey: ['grok-session', sessionId] }),
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
                    session.agentName,
                    session.currentModelId,
                    session.modelLabel,
                    session.gitBranch,
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
            .filter((session): session is GrokSessionSummary => session !== null);
    const openExportForSessions = (selectedSessions: GrokSessionSummary[]) => {
        if (selectedSessions.length === 0) {
            return;
        }

        setPendingExport(buildSessionExport(selectedSessions));
    };
    const openDeleteForSessions = (selectedSessions: GrokSessionSummary[]) => {
        if (selectedSessions.length > 0) {
            setPendingDelete({ sessions: selectedSessions });
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search session title, id, model, or branch"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Grok workspace"
                subtitle="Inspect local Grok CLI sessions, reasoning summaries, tool calls, and exportable conversation text."
                title={workspace.label}
            />

            <GrokSessionsTable
                sessions={visibleSessions}
                onDeleteSession={(session) => openDeleteForSessions([session])}
                onDeleteSessions={(sessionIds) => openDeleteForSessions(lookupSelectedSessions(sessionIds))}
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
                onExport={(options) => exportMutation.mutate(options)}
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
}
