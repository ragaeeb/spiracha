import type { ClaudeCodeSessionSummary, ClaudeCodeWorkspaceGroup } from '@spiracha/lib/claude-code-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ClaudeCodeSessionsTable } from '#/components/claude-code-sessions-table';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { claudeCodeSessionsQueryOptions, claudeCodeWorkspacesQueryOptions } from '#/lib/claude-code-queries';
import { deleteClaudeCodeSessionFn, exportClaudeCodeSessionFn } from '#/lib/claude-code-server';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { matchesTextQuery } from '#/lib/text-filter';

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

const findWorkspaceOrThrow = (workspaces: ClaudeCodeWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Claude Code workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

export const Route = createFileRoute('/claude-code/$workspaceKey')({
    component: ClaudeCodeWorkspacePage,
    errorComponent: ClaudeCodeWorkspaceErrorComponent,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(claudeCodeWorkspacesQueryOptions());
        findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(claudeCodeSessionsQueryOptions(params.workspaceKey));
    },
    pendingComponent: () => (
        <LoadingPanel description="Loading Claude Code sessions and transcript metadata." title="Loading workspace" />
    ),
});

function ClaudeCodeWorkspaceErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Claude Code workspace" />;
}

function ClaudeCodeWorkspacePage() {
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(claudeCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(claudeCodeSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<ClaudeCodeSessionSummary | null>(null);
    const [pendingExport, setPendingExport] = useState<ClaudeCodeSessionSummary | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No Claude Code session selected for export');
            }

            const download = await exportClaudeCodeSessionFn({
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
        mutationFn: async (session: ClaudeCodeSessionSummary) =>
            deleteClaudeCodeSessionFn({ data: { sessionId: session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['claude-code-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['claude-code-sessions', workspace.key] }),
                pendingDelete
                    ? queryClient.invalidateQueries({ queryKey: ['claude-code-session', pendingDelete.sessionId] })
                    : Promise.resolve(),
            ]);
            setPendingDelete(null);
        },
    });

    const visibleSessions = sessions.filter((session) =>
        matchesTextQuery(deferredSearch, [
            session.title,
            session.sessionId,
            session.model,
            session.version,
            session.gitBranch,
            session.filePath,
        ]),
    );

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search session title, id, model, or version"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Claude Code workspace"
                subtitle="Inspect local Claude Code sessions, user prompts, assistant responses, tool calls, and token totals."
                title={workspace.label}
            />

            <ClaudeCodeSessionsTable
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
                        ? `Permanently delete "${pendingDelete.title}" from Claude Code history. This removes the session JSONL file from disk.`
                        : 'Permanently delete this Claude Code session from disk.'
                }
                errorMessage={
                    deleteMutation.isError
                        ? deleteMutation.error instanceof Error
                            ? deleteMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={pendingDelete !== null}
                title="Delete this Claude Code session?"
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
