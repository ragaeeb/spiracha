import type { QoderSessionSummary, QoderWorkspaceGroup } from '@spiracha/lib/qoder-exporter-types';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { QoderSessionsTable } from '#/components/qoder-sessions-table';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { qoderSessionsQueryOptions, qoderWorkspacesQueryOptions } from '#/lib/qoder-queries';
import { exportQoderSessionFn } from '#/lib/qoder-server';
import { matchesTextQuery } from '#/lib/text-filter';

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

const findWorkspaceOrThrow = (workspaces: QoderWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Qoder workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

const QoderWorkspaceErrorComponent = ({ error }: { error: Error }) => {
    return <ReloadErrorPanel description={error.message} title="Failed to load Qoder workspace" />;
};

const QoderWorkspacePage = () => {
    const params = Route.useParams();
    const workspaces = useSuspenseQuery(qoderWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(qoderSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingExport, setPendingExport] = useState<QoderSessionSummary | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No Qoder session selected for export');
            }

            const download = await exportQoderSessionFn({
                data: {
                    includeCommentary: options.includeCommentary,
                    includeMetadata: options.includeMetadata,
                    includeTools: options.includeTools,
                    outputFormat: options.outputFormat,
                    sessionId: pendingExport.sessionId,
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

    const visibleSessions = sessions.filter((session) =>
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
    );

    return (
        <div className="space-y-6">
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

            <QoderSessionsTable sessions={visibleSessions} onExportSession={setPendingExport} />

            <ExportDialog
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                title={pendingExport ? `Export ${pendingExport.title}` : 'Export session'}
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
