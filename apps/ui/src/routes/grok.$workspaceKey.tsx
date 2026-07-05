import type { GrokSessionSummary, GrokWorkspaceGroup } from '@spiracha/lib/grok-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { GrokSessionsTable } from '#/components/grok-sessions-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { grokSessionsQueryOptions, grokWorkspacesQueryOptions } from '#/lib/grok-queries';
import { deleteGrokSessionFn, exportGrokSessionFn } from '#/lib/grok-server';
import { matchesTextQuery } from '#/lib/text-filter';

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

const findWorkspaceOrThrow = (workspaces: GrokWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Grok workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

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
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(grokWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(grokSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<GrokSessionSummary | null>(null);
    const [pendingExport, setPendingExport] = useState<GrokSessionSummary | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No Grok session selected for export');
            }

            const download = await exportGrokSessionFn({
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
        mutationFn: async (session: GrokSessionSummary) =>
            deleteGrokSessionFn({ data: { sessionId: session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['grok-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['grok-sessions', workspace.key] }),
                pendingDelete
                    ? queryClient.invalidateQueries({ queryKey: ['grok-session', pendingDelete.sessionId] })
                    : Promise.resolve(),
            ]);
            setPendingDelete(null);
        },
    });

    const visibleSessions = sessions.filter((session) =>
        matchesTextQuery(deferredSearch, [
            session.title,
            session.sessionId,
            session.agentName,
            session.currentModelId,
            session.modelLabel,
            session.gitBranch,
        ]),
    );

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
                onDeleteSession={setPendingDelete}
                onExportSession={setPendingExport}
            />

            <ExportDialog
                errorMessage={
                    exportMutation.isError
                        ? exportMutation.error instanceof Error
                            ? exportMutation.error.message
                            : 'Session export failed'
                        : null
                }
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

            <DeleteConfirmDialog
                confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete session'}
                description={
                    pendingDelete
                        ? `Permanently delete "${pendingDelete.title}" from Grok history. This removes the session directory and transcript files under ~/.grok/sessions.`
                        : 'Permanently delete this Grok session from local history.'
                }
                errorMessage={
                    deleteMutation.isError
                        ? deleteMutation.error instanceof Error
                            ? deleteMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={pendingDelete !== null}
                title="Delete this Grok session?"
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
}
