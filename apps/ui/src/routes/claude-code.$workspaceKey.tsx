import type { ClaudeCodeSessionSummary, ClaudeCodeWorkspaceGroup } from '@spiracha/lib/claude-code-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { ClaudeCodeSessionsTable } from '#/components/claude-code-sessions-table';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { Checkbox } from '#/components/ui/checkbox';
import { claudeCodeSessionsQueryOptions, claudeCodeWorkspacesQueryOptions } from '#/lib/claude-code-queries';
import {
    deleteClaudeCodeSessionFn,
    deleteClaudeCodeSessionsFn,
    exportClaudeCodeSessionFn,
    exportClaudeCodeSessionsFn,
} from '#/lib/claude-code-server';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { parseMergedSearch, withMergedSearch } from '#/lib/route-search';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

type PendingSessionDelete = {
    sessions: ClaudeCodeSessionSummary[];
};

type PendingSessionExport = {
    label: string;
    sessionIds: string[];
};

const findWorkspaceOrThrow = (workspaces: ClaudeCodeWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Claude Code workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

const buildSessionExport = (selectedSessions: ClaudeCodeSessionSummary[]): PendingSessionExport => ({
    label: selectedSessions.length === 1 ? selectedSessions[0]!.title : `${selectedSessions.length} selected sessions`,
    sessionIds: selectedSessions.map((session) => session.sessionId),
});

const getDeleteConfirmLabel = (pendingDelete: PendingSessionDelete | null, isPending: boolean) => {
    if (isPending) {
        return 'Deleting...';
    }

    return pendingDelete && pendingDelete.sessions.length > 1 ? 'Delete sessions' : 'Delete session';
};

const getDeleteDescription = (pendingDelete: PendingSessionDelete | null, merged: boolean) => {
    if (!pendingDelete) {
        return 'Permanently delete the selected Claude Code sessions from disk.';
    }

    if (pendingDelete.sessions.length === 1) {
        const target = merged ? 'every physical continuation segment' : 'the session JSONL file';
        return `Permanently delete "${pendingDelete.sessions[0]!.title}" from Claude Code history. This removes ${target} from disk.`;
    }

    return `Permanently delete ${pendingDelete.sessions.length} selected Claude Code sessions from disk.`;
};

const getDeleteTitle = (pendingDelete: PendingSessionDelete | null) =>
    pendingDelete && pendingDelete.sessions.length > 1
        ? `Delete ${pendingDelete.sessions.length} Claude Code sessions?`
        : 'Delete this Claude Code session?';

export const Route = createFileRoute('/claude-code/$workspaceKey')({
    component: ClaudeCodeWorkspacePage,
    errorComponent: ClaudeCodeWorkspaceErrorComponent,
    loader: async ({ context, deps, params }) => {
        const { merged } = deps as { merged: boolean };
        const workspaces = await context.queryClient.ensureQueryData(claudeCodeWorkspacesQueryOptions());
        findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(claudeCodeSessionsQueryOptions(params.workspaceKey, merged));
    },
    loaderDeps: ({ search }) => ({ merged: search.merged === true }),
    pendingComponent: () => (
        <LoadingPanel description="Loading Claude Code sessions and transcript metadata." title="Loading workspace" />
    ),
    validateSearch: parseMergedSearch,
});

function ClaudeCodeWorkspaceErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Claude Code workspace" />;
}

function ClaudeCodeWorkspacePage() {
    const navigate = useNavigate({ from: Route.fullPath });
    const params = Route.useParams();
    const routeSearch = Route.useSearch();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(claudeCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const merged = routeSearch.merged === true;
    const sessions = useSuspenseQuery(claudeCodeSessionsQueryOptions(workspace.key, merged)).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingSessionDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingSessionExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportMutation = useMutation({
        mutationFn: async ({ ids, options }: ExportSelectionMutationInput) => {
            const download =
                ids.length === 1
                    ? await exportClaudeCodeSessionFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              merged,
                              outputFormat: options.outputFormat,
                              sessionId: ids[0]!,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportClaudeCodeSessionsFn({
                          data: {
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              merged,
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

    const deleteMutation = useMutation({
        mutationFn: async (sessionIds: string[]) =>
            sessionIds.length === 1
                ? deleteClaudeCodeSessionFn({ data: { merged, sessionId: sessionIds[0]! } })
                : deleteClaudeCodeSessionsFn({ data: { merged, sessionIds } }),
        onSettled: async (_result, _error, sessionIds) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['claude-code-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['claude-code-sessions', workspace.key] }),
                ...sessionIds.map((sessionId) =>
                    queryClient.invalidateQueries({ queryKey: ['claude-code-session', sessionId] }),
                ),
            ]);
        },
        onSuccess: async (_result, sessionIds) => {
            const workspaceEmptied = isWorkspaceEmptiedByDelete(sessions, sessionIds, (session) => session.sessionId);
            setPendingDelete(null);
            if (workspaceEmptied) {
                await navigate({ to: '/claude-code' });
            }
        },
    });

    const visibleSessions = useMemo(
        () =>
            sessions.filter((session) =>
                matchesTextQuery(deferredSearch, [
                    session.title,
                    session.sessionId,
                    session.model,
                    session.version,
                    session.gitBranch,
                    session.filePath,
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
            .filter((session): session is ClaudeCodeSessionSummary => session !== null);
    const openExportForSessions = (selectedSessions: ClaudeCodeSessionSummary[]) => {
        if (selectedSessions.length === 0) {
            return;
        }

        setPendingExport(buildSessionExport(selectedSessions));
    };
    const openDeleteForSessions = (selectedSessions: ClaudeCodeSessionSummary[]) => {
        if (selectedSessions.length > 0) {
            setPendingDelete({ sessions: selectedSessions });
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 text-sm">
                            <Checkbox
                                aria-label="Merge continuations"
                                checked={merged}
                                id="merge-claude-code-continuations"
                                onCheckedChange={(value) => {
                                    void navigate({
                                        params: true,
                                        replace: true,
                                        search: (previous: Record<string, unknown>) =>
                                            withMergedSearch(previous, value === true),
                                    });
                                }}
                            />
                            <label htmlFor="merge-claude-code-continuations">Merge continuations</label>
                        </div>
                        <ListSearchInput
                            placeholder="Search session title, id, model, or version"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="Claude Code workspace"
                subtitle="Inspect local Claude Code sessions, user prompts, assistant responses, tool calls, and token totals."
                title={workspace.label}
            />

            <ClaudeCodeSessionsTable
                merged={merged}
                sessions={visibleSessions}
                onDeleteSession={(session) => openDeleteForSessions([session])}
                onDeleteSessions={(sessionIds) => openDeleteForSessions(lookupSelectedSessions(sessionIds))}
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

            <DeleteConfirmDialog
                confirmLabel={getDeleteConfirmLabel(pendingDelete, deleteMutation.isPending)}
                description={getDeleteDescription(pendingDelete, merged)}
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
