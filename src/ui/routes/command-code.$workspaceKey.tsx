import type { CommandCodeSessionSummary, CommandCodeWorkspaceGroup } from '@spiracha/lib/command-code-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { CommandCodeSessionsTable } from '#/components/command-code-sessions-table';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Button } from '#/components/ui/button';
import { commandCodeSessionsQueryOptions, commandCodeWorkspacesQueryOptions } from '#/lib/command-code-queries';
import {
    deleteCommandCodeSessionFn,
    deleteCommandCodeSessionsFn,
    exportCommandCodeSessionFn,
    exportCommandCodeSessionsFn,
} from '#/lib/command-code-server';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

type PendingSessionDelete = {
    scope: 'all' | 'selected';
    sessions: CommandCodeSessionSummary[];
};

type PendingSessionExport = {
    label: string;
    sessionIds: string[];
};

const buildSessionExport = (selectedSessions: CommandCodeSessionSummary[]) => ({
    label: selectedSessions.length === 1 ? selectedSessions[0]!.title : `${selectedSessions.length} selected sessions`,
    sessionIds: selectedSessions.map((session) => session.sessionId),
});

const findWorkspaceOrThrow = (workspaces: CommandCodeWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Command Code workspace not found: ${workspaceKey}`);
    }
    return workspace;
};

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
        return 'Permanently delete the selected Command Code sessions from disk.';
    }

    if (pendingDelete.scope === 'all') {
        return `Permanently delete all ${pendingDelete.sessions.length} Command Code sessions in this workspace from disk. This removes session JSONL files and matching metadata/checkpoint sidecars.`;
    }

    if (pendingDelete.sessions.length === 1) {
        return `Permanently delete "${pendingDelete.sessions[0]!.title}" from Command Code history. This removes its session JSONL file and matching metadata/checkpoint sidecars.`;
    }

    return `Permanently delete ${pendingDelete.sessions.length} selected Command Code sessions from disk. This removes session JSONL files and matching metadata/checkpoint sidecars.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) => {
    if (pendingDelete?.scope === 'all') {
        return `Delete all ${pendingDelete.sessions.length} Command Code sessions?`;
    }

    return pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} Command Code sessions?`
        : 'Delete this Command Code session?';
};

const CommandCodeWorkspacePage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(commandCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(commandCodeSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingSessionDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingSessionExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);
    const exportMutation = useMutation({
        mutationFn: async ({ ids, options }: ExportSelectionMutationInput) => {
            const download =
                ids.length === 1
                    ? await exportCommandCodeSessionFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionId: ids[0]!,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportCommandCodeSessionsFn({
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

            await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl);
        },
        onSuccess: () => setPendingExport(null),
    });
    const deleteMutation = useMutation({
        mutationFn: async (sessionIds: string[]) =>
            sessionIds.length === 1
                ? deleteCommandCodeSessionFn({ data: { sessionId: sessionIds[0]! } })
                : deleteCommandCodeSessionsFn({ data: { sessionIds } }),
        onSettled: async (_result, _error, sessionIds) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['command-code-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['command-code-sessions', workspace.key] }),
                ...sessionIds.map((sessionId) =>
                    queryClient.invalidateQueries({ queryKey: ['command-code-session', sessionId] }),
                ),
            ]);
        },
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/command-code' });
            }
        },
    });
    const visibleSessions = useMemo(
        () =>
            sessions.filter((session) =>
                matchesTextQuery(deferredSearch, [
                    session.title,
                    session.sessionId,
                    session.model,
                    session.modelLabel,
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
            .filter((session): session is CommandCodeSessionSummary => session !== null);
    const openExportForSessions = (selectedSessions: CommandCodeSessionSummary[]) => {
        if (selectedSessions.length > 0) {
            setPendingExport(buildSessionExport(selectedSessions));
        }
    };
    const openDeleteForSessions = (
        selectedSessions: CommandCodeSessionSummary[],
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
                            placeholder="Search session title, id, model, or file"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="Command Code workspace"
                subtitle={workspace.worktree}
                title={workspace.label}
            />
            <CommandCodeSessionsTable
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
                            : 'Export failed'
                        : null
                }
                forceZipArchive={pendingExport ? pendingExport.sessionIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                rawExport={pendingExport ? { ids: pendingExport.sessionIds, source: 'command-code' } : undefined}
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

export const Route = createFileRoute('/command-code/$workspaceKey')({
    component: CommandCodeWorkspacePage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Command Code workspace" />,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(commandCodeWorkspacesQueryOptions());
        const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(commandCodeSessionsQueryOptions(workspace.key));
    },
    pendingComponent: () => (
        <LoadingPanel description="Loading Command Code sessions and transcript metadata." title="Loading workspace" />
    ),
});
