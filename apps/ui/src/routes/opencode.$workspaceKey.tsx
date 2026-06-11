import type { OpenCodeSessionSummary, OpenCodeWorkspaceGroup } from '@spiracha/lib/opencode-exporter-types';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { OpenCodeSessionsTable } from '#/components/opencode-sessions-table';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { downloadTextFile } from '#/lib/download';
import { openCodeSessionsQueryOptions, openCodeWorkspacesQueryOptions } from '#/lib/opencode-queries';
import { exportOpenCodeSessionFn } from '#/lib/opencode-server';
import { matchesTextQuery } from '#/lib/text-filter';

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

const findWorkspaceOrThrow = (workspaces: OpenCodeWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`OpenCode workspace not found: ${workspaceKey}`);
    }

    return workspace;
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

function OpenCodeWorkspacePage() {
    const params = Route.useParams();
    const workspaces = useSuspenseQuery(openCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(openCodeSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingExport, setPendingExport] = useState<OpenCodeSessionSummary | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No OpenCode session selected for export');
            }

            const download = await exportOpenCodeSessionFn({
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
            session.slug,
            session.agent,
            session.modelLabel,
            session.directory,
        ]),
    );

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search session title, id, model, or agent"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="OpenCode workspace"
                subtitle="Inspect local OpenCode sessions, transcript parts, tool calls, reasoning, token totals, and exportable conversation text."
                title={workspace.label}
            />

            <OpenCodeSessionsTable sessions={visibleSessions} onExportSession={setPendingExport} />

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
