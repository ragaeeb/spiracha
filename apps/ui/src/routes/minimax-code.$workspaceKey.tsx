import type { MiniMaxCodeSessionSummary, MiniMaxCodeWorkspaceGroup } from '@spiracha/lib/minimax-code-exporter-types';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { MiniMaxCodeSessionsTable } from '#/components/minimax-code-sessions-table';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { miniMaxCodeSessionsQueryOptions, miniMaxCodeWorkspacesQueryOptions } from '#/lib/minimax-code-queries';
import { exportMiniMaxCodeSessionFn, exportMiniMaxCodeSessionsFn } from '#/lib/minimax-code-server';
import { matchesTextQuery } from '#/lib/text-filter';

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

const MiniMaxCodeWorkspaceErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load MiniMax Code workspace" />;
};

const MiniMaxCodeWorkspacePage = () => {
    const params = Route.useParams();
    const workspaces = useSuspenseQuery(miniMaxCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(miniMaxCodeSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
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

    const openExportForSessions = (selectedSessions: MiniMaxCodeSessionSummary[]) => {
        if (selectedSessions.length > 0) {
            setPendingExport(buildSessionExport(selectedSessions));
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search title, model, agent, or ID"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="MiniMax Code workspace"
                subtitle={workspace.worktree}
                title={workspace.label}
            />
            <MiniMaxCodeSessionsTable
                sessions={visibleSessions}
                onExportSession={(session) => openExportForSessions([session])}
                onExportSessions={(sessionIds) =>
                    openExportForSessions(
                        sessionIds.flatMap((sessionId) => {
                            const session = visibleSessionsById.get(sessionId);
                            return session ? [session] : [];
                        }),
                    )
                }
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
