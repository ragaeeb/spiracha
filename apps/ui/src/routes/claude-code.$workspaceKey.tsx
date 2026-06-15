import type { ClaudeCodeSessionSummary, ClaudeCodeWorkspaceGroup } from '@spiracha/lib/claude-code-exporter-types';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ClaudeCodeSessionsTable } from '#/components/claude-code-sessions-table';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { claudeCodeSessionsQueryOptions, claudeCodeWorkspacesQueryOptions } from '#/lib/claude-code-queries';
import { exportClaudeCodeSessionFn } from '#/lib/claude-code-server';
import { downloadTextFile } from '#/lib/download';
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
    const workspaces = useSuspenseQuery(claudeCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(claudeCodeSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
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
                },
            });
            downloadTextFile(download.fileName, download.content, download.mimeType);
        },
        onSuccess: () => {
            setPendingExport(null);
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

            <ClaudeCodeSessionsTable sessions={visibleSessions} onExportSession={setPendingExport} />

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
}
