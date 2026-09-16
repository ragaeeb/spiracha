import type { QoderSessionSummary, QoderWorkspaceGroup } from '@spiracha/lib/qoder-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { QoderSessionsTable } from '#/components/qoder-sessions-table';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Button } from '#/components/ui/button';
import { conversationListSelection, lookupSelectedItems } from '#/lib/conversation-selection';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { qoderSessionsQueryOptions, qoderWorkspacesQueryOptions } from '#/lib/qoder-queries';
import {
    deleteQoderSessionFn,
    deleteQoderSessionsFn,
    exportQoderSessionFn,
    exportQoderSessionsFn,
} from '#/lib/qoder-server';
import { invalidateSourceConversationQueries } from '#/lib/source-query-bindings';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

type PendingSessionDelete = { scope: 'all' | 'selected'; sessions: QoderSessionSummary[] };
type PendingSessionExport = {
    label: string;
    sessionIds: string[];
};

const findWorkspaceOrThrow = (workspaces: QoderWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Qoder workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

const QoderWorkspaceErrorComponent = ({ error }: { error: unknown }) => {
    return <RouteErrorPanel error={error} title="Failed to load Qoder workspace" />;
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
        return 'Permanently delete the selected Qoder sessions.';
    }
    const count = pendingDelete.sessions.length;
    const ownedNote =
        count === 1
            ? 'This removes matching local-history records, owned task references, and captured state or CLI files for that conversation.'
            : `This removes matching local-history records, owned task references, and captured state or CLI files for ${count} conversations.`;
    const target =
        pendingDelete.scope === 'all'
            ? `all ${count} Qoder sessions in this workspace`
            : count === 1
              ? `"${pendingDelete.sessions[0]!.title}"`
              : `${count} selected Qoder sessions`;
    return `Permanently delete ${target}. ${ownedNote} Workspace source files and the shared Qoder database file are preserved.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) => {
    if (pendingDelete?.scope === 'all') {
        return `Delete all ${pendingDelete.sessions.length} Qoder sessions?`;
    }
    return pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} Qoder sessions?`
        : 'Delete this Qoder session?';
};

const QoderWorkspacePage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const params = Route.useParams();
    const workspaces = useSuspenseQuery(qoderWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(qoderSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingSessionDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingSessionExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async ({ ids, options }: ExportSelectionMutationInput) => {
            const download =
                ids.length === 1
                    ? await exportQoderSessionFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionId: ids[0]!,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportQoderSessionsFn({
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
        onSuccess: () => {
            setPendingExport(null);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (sessionIds: string[]) =>
            sessionIds.length === 1
                ? deleteQoderSessionFn({ data: { sessionId: sessionIds[0]! } })
                : deleteQoderSessionsFn({ data: { sessionIds } }),
        onSettled: async (_result, error, sessionIds) => {
            await invalidateSourceConversationQueries(queryClient, 'qoder', {
                ids: sessionIds,
                removeDetails: error == null,
                workspaceKey: workspace.key,
            });
        },
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/qoder' });
            }
        },
    });

    const visibleSessions = useMemo(
        () =>
            sessions.filter((session) =>
                matchesTextQuery(deferredSearch, [
                    session.title,
                    session.sessionId,
                    session.taskId,
                    session.requestId,
                    session.model,
                    session.status,
                    session.executionMode,
                    session.agentClass,
                    session.query,
                    session.sourceStatePath,
                ]),
            ),
        [deferredSearch, sessions],
    );
    const lookupSelectedSessions = (sessionIds: string[]) =>
        lookupSelectedItems(sessionIds, sessions, (session) => session.sessionId);
    const openExportForSessions = (selectedSessions: QoderSessionSummary[]) => {
        if (selectedSessions.length === 0) {
            return;
        }

        setPendingExport({
            label:
                selectedSessions.length === 1
                    ? selectedSessions[0]!.title
                    : `${selectedSessions.length} selected sessions`,
            sessionIds: selectedSessions.map((session) => session.sessionId),
        });
    };
    const openDelete = (selected: QoderSessionSummary[], scope: PendingSessionDelete['scope']) => {
        if (selected.length === 0) {
            return;
        }
        setPendingDelete({ scope, sessions: selected });
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
                            onClick={() => openDelete(sessions, 'all')}
                        >
                            <Trash2 className="size-4" /> Delete all
                        </Button>
                        <ListSearchInput
                            placeholder="Search session title, id, status, or request"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="Qoder workspace"
                subtitle="Inspect local Qoder prompts, session metadata, and file-operation history."
                title={workspace.label}
            />

            <QoderSessionsTable
                {...conversationListSelection(
                    'qoder',
                    sessions.map((session) => session.sessionId),
                    workspace.key,
                )}
                sessions={visibleSessions}
                onDeleteSession={(session) => openDelete([session], 'selected')}
                onDeleteSessions={(sessionIds) => openDelete(lookupSelectedSessions(sessionIds), 'selected')}
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
                rawExport={pendingExport ? { ids: pendingExport.sessionIds, source: 'qoder' } : undefined}
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

export const Route = createFileRoute('/qoder/$workspaceKey')({
    component: QoderWorkspacePage,
    errorComponent: QoderWorkspaceErrorComponent,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(qoderWorkspacesQueryOptions());
        findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(qoderSessionsQueryOptions(params.workspaceKey));
    },
    pendingComponent: () => (
        <LoadingPanel description="Loading Qoder sessions and local metadata." title="Loading workspace" />
    ),
});
