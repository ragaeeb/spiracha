import type { QoderSessionSummary, QoderWorkspaceGroup } from '@spiracha/lib/qoder-exporter-types';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { QoderSessionsTable } from '#/components/qoder-sessions-table';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { qoderSessionsQueryOptions, qoderWorkspacesQueryOptions } from '#/lib/qoder-queries';
import { exportQoderSessionFn, exportQoderSessionsFn } from '#/lib/qoder-server';
import { matchesTextQuery } from '#/lib/text-filter';

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

const QoderWorkspaceErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load Qoder workspace" />;
};

const QoderWorkspacePage = () => {
    const params = Route.useParams();
    const workspaces = useSuspenseQuery(qoderWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(qoderSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
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

            await downloadUrlFile(download.fileName, download.downloadUrl);
        },
        onSuccess: () => {
            setPendingExport(null);
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
    const visibleSessionsById = useMemo(
        () => new Map(visibleSessions.map((session) => [session.sessionId, session])),
        [visibleSessions],
    );
    const lookupSelectedSessions = (sessionIds: string[]) =>
        sessionIds
            .map((sessionId) => visibleSessionsById.get(sessionId) ?? null)
            .filter((session): session is QoderSessionSummary => session !== null);
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

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search session title, id, status, or request"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Qoder workspace"
                subtitle="Inspect local Qoder prompts, session metadata, and file-operation history."
                title={workspace.label}
            />

            <QoderSessionsTable
                sessions={visibleSessions}
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
