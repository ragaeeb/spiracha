import type { OpenCodeSessionSummary, OpenCodeWorkspaceGroup } from '@spiracha/lib/opencode-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { OpenCodeSessionsTable } from '#/components/opencode-sessions-table';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { Button } from '#/components/ui/button';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { openCodeSessionsQueryOptions, openCodeWorkspacesQueryOptions } from '#/lib/opencode-queries';
import {
    deleteOpenCodeSessionFn,
    deleteOpenCodeSessionsFn,
    exportOpenCodeSessionFn,
    exportOpenCodeSessionsFn,
} from '#/lib/opencode-server';
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
    scope: 'all' | 'selected';
    sessions: OpenCodeSessionSummary[];
};

type PendingSessionExport = {
    label: string;
    sessionIds: string[];
};

const buildSessionExport = (selectedSessions: OpenCodeSessionSummary[]): PendingSessionExport => ({
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
        return 'Permanently delete the selected OpenCode sessions from the database.';
    }

    if (pendingDelete.scope === 'all') {
        return `Permanently delete all ${pendingDelete.sessions.length} OpenCode sessions in this workspace from the database, including child sessions, messages, and parts.`;
    }

    if (pendingDelete.sessions.length === 1) {
        return `Permanently delete "${pendingDelete.sessions[0]!.title}" from OpenCode history. This removes the session, child sessions, messages, and parts from the OpenCode database.`;
    }

    return `Permanently delete ${pendingDelete.sessions.length} selected OpenCode sessions from the database, including child sessions, messages, and parts.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) => {
    if (pendingDelete?.scope === 'all') {
        return `Delete all ${pendingDelete.sessions.length} OpenCode sessions?`;
    }

    return pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} OpenCode sessions?`
        : 'Delete this OpenCode session?';
};

export const Route = createFileRoute('/opencode/$workspaceKey')({
    component: OpenCodeWorkspacePage,
    errorComponent: OpenCodeWorkspaceErrorComponent,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(openCodeWorkspacesQueryOptions());
        findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(openCodeSessionsQueryOptions(params.workspaceKey));
    },
    pendingComponent: () => (
        <LoadingPanel description="Loading OpenCode sessions and transcript metadata." title="Loading workspace" />
    ),
});

function OpenCodeWorkspaceErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load OpenCode workspace" />;
}

const findWorkspaceOrThrow = (workspaces: OpenCodeWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`OpenCode workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

function OpenCodeWorkspacePage() {
    const params = Route.useParams();
    const workspaces = useSuspenseQuery(openCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(openCodeSessionsQueryOptions(workspace.key)).data;

    return <OpenCodeWorkspaceContent sessions={sessions} workspace={workspace} />;
}

function OpenCodeWorkspaceContent({
    sessions,
    workspace,
}: {
    sessions: OpenCodeSessionSummary[];
    workspace: OpenCodeWorkspaceGroup;
}) {
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingSessionDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingSessionExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No OpenCode session selected for export');
            }

            const download =
                pendingExport.sessionIds.length === 1
                    ? await exportOpenCodeSessionFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              sessionId: pendingExport.sessionIds[0]!,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportOpenCodeSessionsFn({
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
                ? deleteOpenCodeSessionFn({ data: { sessionId: sessionIds[0]! } })
                : deleteOpenCodeSessionsFn({ data: { sessionIds } }),
        onSettled: async (_result, _error, sessionIds) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['opencode-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['opencode-sessions', workspace.key] }),
                ...sessionIds.map((sessionId) =>
                    queryClient.invalidateQueries({ queryKey: ['opencode-session', sessionId] }),
                ),
            ]);
        },
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/opencode' });
            }
        },
    });

    const visibleSessions = useMemo(
        () =>
            sessions.filter((session) =>
                matchesTextQuery(deferredSearch, [
                    session.title,
                    session.sessionId,
                    session.slug,
                    session.agent,
                    session.modelLabel,
                    session.directory,
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
            .filter((session): session is OpenCodeSessionSummary => session !== null);
    const openExportForSessions = (selectedSessions: OpenCodeSessionSummary[]) => {
        if (selectedSessions.length === 0) {
            return;
        }

        setPendingExport(buildSessionExport(selectedSessions));
    };
    const openDeleteForSessions = (
        selectedSessions: OpenCodeSessionSummary[],
        scope: PendingSessionDelete['scope'],
    ) => {
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
                            placeholder="Search session title, id, model, or agent"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="OpenCode workspace"
                subtitle="Inspect local OpenCode sessions, transcript parts, tool calls, reasoning, token totals, and exportable conversation text."
                title={workspace.label}
            />

            <OpenCodeSessionsTable
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
