import type { MiniMaxCodeSessionSummary, MiniMaxCodeWorkspaceGroup } from '@spiracha/lib/minimax-code-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { MiniMaxCodeSessionsTable } from '#/components/minimax-code-sessions-table';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Button } from '#/components/ui/button';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { miniMaxCodeSessionsQueryOptions, miniMaxCodeWorkspacesQueryOptions } from '#/lib/minimax-code-queries';
import {
    deleteMiniMaxCodeSessionFn,
    deleteMiniMaxCodeSessionsFn,
    exportMiniMaxCodeSessionFn,
    exportMiniMaxCodeSessionsFn,
} from '#/lib/minimax-code-server';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

type PendingSessionDelete = {
    scope: 'all' | 'selected';
    sessions: MiniMaxCodeSessionSummary[];
};

type PendingSessionExport = {
    label: string;
    sessionIds: string[];
};

const findWorkspaceOrThrow = (workspaces: MiniMaxCodeWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`MiniMax Code workspace not found: ${workspaceKey}`);
    }
    return workspace;
};

const buildSessionExport = (sessions: MiniMaxCodeSessionSummary[]): PendingSessionExport => ({
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
        return 'Permanently delete the selected MiniMax Code sessions.';
    }
    const count = pendingDelete.sessions.length;
    const target =
        pendingDelete.scope === 'all'
            ? `all ${count} MiniMax Code sessions in this workspace`
            : count === 1
              ? `"${pendingDelete.sessions[0]!.title}"`
              : `${count} selected MiniMax Code sessions`;
    return `Permanently delete ${target}. This removes finalized session directories and runtime database rows. Generated workspace files and observability logs are preserved.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) => {
    if (pendingDelete?.scope === 'all') {
        return `Delete all ${pendingDelete.sessions.length} MiniMax Code sessions?`;
    }
    return pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} MiniMax Code sessions?`
        : 'Delete this MiniMax Code session?';
};

const MiniMaxCodeWorkspaceErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load MiniMax Code workspace" />;
};

const MiniMaxCodeWorkspacePage = () => {
    const navigate = useNavigate({ from: Route.fullPath });
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(miniMaxCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(miniMaxCodeSessionsQueryOptions(workspace.key)).data;
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
                    session.agentName,
                    session.currentModelId,
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
            const download =
                ids.length === 1
                    ? await exportMiniMaxCodeSessionFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionId: ids[0]!,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportMiniMaxCodeSessionsFn({
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
        onSuccess: () => setPendingExport(null),
    });

    const deleteMutation = useMutation({
        mutationFn: async (sessionIds: string[]) =>
            sessionIds.length === 1
                ? deleteMiniMaxCodeSessionFn({ data: { sessionId: sessionIds[0]! } })
                : deleteMiniMaxCodeSessionsFn({ data: { sessionIds } }),
        onSettled: async (_result, _error, sessionIds) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['minimax-code-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['minimax-code-sessions', workspace.key] }),
                ...sessionIds.map((sessionId) =>
                    queryClient.invalidateQueries({ queryKey: ['minimax-code-session', sessionId] }),
                ),
            ]);
        },
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/minimax-code' });
            }
        },
    });

    const lookupSelectedSessions = (sessionIds: string[]) =>
        sessionIds
            .map((sessionId) => visibleSessionsById.get(sessionId) ?? null)
            .filter((session): session is MiniMaxCodeSessionSummary => session !== null);
    const openExportForSessions = (selectedSessions: MiniMaxCodeSessionSummary[]) => {
        if (selectedSessions.length > 0) {
            setPendingExport(buildSessionExport(selectedSessions));
        }
    };
    const openDeleteForSessions = (
        selectedSessions: MiniMaxCodeSessionSummary[],
        scope: PendingSessionDelete['scope'],
    ) => {
        if (selectedSessions.length > 0) {
            setPendingDelete({ scope, sessions: selectedSessions });
        }
    };

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
                            onClick={() => openDeleteForSessions(sessions, 'all')}
                        >
                            <Trash2 className="size-4" />
                            Delete all
                        </Button>
                        <ListSearchInput
                            placeholder="Search title, model, agent, or ID"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="MiniMax Code workspace"
                subtitle={workspace.worktree}
                title={workspace.label}
            />
            <MiniMaxCodeSessionsTable
                sessions={visibleSessions}
                onDeleteSession={(session) => openDeleteForSessions([session], 'selected')}
                onDeleteSessions={(sessionIds) => openDeleteForSessions(lookupSelectedSessions(sessionIds), 'selected')}
                onExportSession={(session) => openExportForSessions([session])}
                onExportSessions={(sessionIds) => openExportForSessions(lookupSelectedSessions(sessionIds))}
            />
            <ExportDialog
                focusedEvidenceTarget={
                    pendingExport?.sessionIds.length === 1
                        ? { id: pendingExport.sessionIds[0]!, source: 'minimax-code' }
                        : undefined
                }
                errorMessage={
                    exportMutation.isError
                        ? exportMutation.error instanceof Error
                            ? exportMutation.error.message
                            : 'Export failed'
                        : null
                }
                forceZipArchive={pendingExport ? pendingExport.sessionIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                title={`Export ${pendingExport?.label ?? 'sessions'}`}
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

export const Route = createFileRoute('/minimax-code/$workspaceKey')({
    component: MiniMaxCodeWorkspacePage,
    errorComponent: MiniMaxCodeWorkspaceErrorComponent,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(miniMaxCodeWorkspacesQueryOptions());
        const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(miniMaxCodeSessionsQueryOptions(workspace.key));
    },
    pendingComponent: () => (
        <LoadingPanel description="Loading MiniMax Code sessions and transcript metadata." title="Loading workspace" />
    ),
});
