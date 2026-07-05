import type { KiroSessionSummary, KiroWorkspaceGroup } from '@spiracha/lib/kiro-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { KiroSessionsTable } from '#/components/kiro-sessions-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { kiroSessionsQueryOptions, kiroWorkspacesQueryOptions } from '#/lib/kiro-queries';
import { deleteKiroSessionFn, exportKiroSessionFn } from '#/lib/kiro-server';
import { matchesTextQuery } from '#/lib/text-filter';

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

const findWorkspaceOrThrow = (workspaces: KiroWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Kiro workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

const KiroWorkspaceErrorComponent = ({ error }: { error: Error }) => {
    return <ReloadErrorPanel description={error.message} title="Failed to load Kiro workspace" />;
};

const KiroWorkspacePage = () => {
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(kiroWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(kiroSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<KiroSessionSummary | null>(null);
    const [pendingExport, setPendingExport] = useState<KiroSessionSummary | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No Kiro session selected for export');
            }

            const download = await exportKiroSessionFn({
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

    const deleteMutation = useMutation({
        mutationFn: async (session: KiroSessionSummary) =>
            deleteKiroSessionFn({ data: { sessionId: session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['kiro-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['kiro-sessions', workspace.key] }),
                pendingDelete
                    ? queryClient.invalidateQueries({ queryKey: ['kiro-session', pendingDelete.sessionId] })
                    : Promise.resolve(),
            ]);
            setPendingDelete(null);
        },
    });

    const visibleSessions = sessions.filter((session) =>
        matchesTextQuery(deferredSearch, [
            session.title,
            session.sessionId,
            session.selectedModel,
            session.defaultModelTitle,
            session.selectedProfileId,
            session.sessionType,
            session.filePath,
        ]),
    );

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
                onDeleteSession={setPendingDelete}
                onExportSession={setPendingExport}
            />

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

            <DeleteConfirmDialog
                confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete session'}
                description={
                    pendingDelete
                        ? `Permanently delete "${pendingDelete.title}" from Kiro history. This removes the session JSON file and matching execution files from disk.`
                        : 'Permanently delete this Kiro session from disk.'
                }
                errorMessage={
                    deleteMutation.isError
                        ? deleteMutation.error instanceof Error
                            ? deleteMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={pendingDelete !== null}
                title="Delete this Kiro session?"
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteMutation.mutate(pendingDelete);
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
