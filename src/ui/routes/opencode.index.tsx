import type { OpenCodeWorkspaceGroup } from '@spiracha/lib/opencode-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { OpenCodeWorkspacesTable } from '#/components/opencode-workspaces-table';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import { openCodeWorkspacesQueryOptions } from '#/lib/opencode-queries';
import { deleteOpenCodeWorkspaceFn, deleteOpenCodeWorkspacesFn } from '#/lib/opencode-server';
import { matchesTextQuery } from '#/lib/text-filter';

type OpenCodeCleanupRetryTarget = {
    token: string;
};

type OpenCodeWorkspaceDeleteResponse = {
    cleanupFailures: Array<{ error: string; path?: string }>;
    retryTarget?: OpenCodeCleanupRetryTarget;
    workspaceKey: string;
};

type OpenCodeWorkspaceDeleteBatchResponse = {
    failures: Array<{ error: string; workspaceKey: string }>;
    results: OpenCodeWorkspaceDeleteResponse[];
};

type PendingOpenCodeWorkspace = OpenCodeWorkspaceGroup & {
    retryTarget?: OpenCodeCleanupRetryTarget;
};

const getWorkspaceDeleteDescription = (workspaces: PendingOpenCodeWorkspace[] | null) => {
    if (!workspaces || workspaces.length === 0) {
        return '';
    }

    if (workspaces.length === 1) {
        return `Permanently delete all OpenCode history and workspace metadata for "${workspaces[0]!.label}". This removes its sessions, child sessions, messages, parts, and desktop state. It does not delete files in the source/worktree directory. Quit OpenCode first. This cannot be undone.`;
    }

    return `Permanently delete all OpenCode history and workspace metadata for ${workspaces.length} selected workspaces. This removes their sessions, child sessions, messages, parts, and desktop state. It does not delete files in the source/worktree directories. Quit OpenCode first. This cannot be undone.`;
};

const OpenCodeErrorComponent = ({ error }: { error: unknown }) => {
    return <RouteErrorPanel error={error} title="Failed to load OpenCode workspaces" />;
};

const OpenCodePage = () => {
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(openCodeWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingOpenCodeWorkspace[] | null>(null);
    const [partialDeleteError, setPartialDeleteError] = useState<string | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const invalidateOpenCodeWorkspaceQueries = async () => {
        await queryClient.invalidateQueries({ queryKey: ['opencode-workspaces'] });
    };

    const deleteWorkspaceMutation = useMutation({
        mutationFn: async (selectedWorkspaces: PendingOpenCodeWorkspace[]) => {
            const retryTargets = selectedWorkspaces.map((workspace) => workspace.retryTarget ?? null);
            if (selectedWorkspaces.length === 1) {
                const workspace = selectedWorkspaces[0]!;
                return deleteOpenCodeWorkspaceFn({
                    data: {
                        ...(workspace.retryTarget ? { retry: workspace.retryTarget } : {}),
                        workspaceKey: workspace.key,
                    },
                });
            }

            return deleteOpenCodeWorkspacesFn({
                data: {
                    retryTargets,
                    workspaceKeys: selectedWorkspaces.map((workspace) => workspace.key),
                },
            });
        },
        onSettled: invalidateOpenCodeWorkspaceQueries,
        onSuccess: (result, selectedWorkspaces) => {
            const response = result as OpenCodeWorkspaceDeleteResponse | OpenCodeWorkspaceDeleteBatchResponse;
            const results: OpenCodeWorkspaceDeleteResponse[] = 'results' in response ? response.results : [response];
            const failures = 'failures' in response ? response.failures : [];
            const resultsByKey = new Map(results.map((entry) => [entry.workspaceKey, entry]));
            const failedKeys = new Set(failures.map((failure) => failure.workspaceKey));
            const retryableWorkspaces: PendingOpenCodeWorkspace[] = selectedWorkspaces.flatMap((workspace) => {
                const resultForWorkspace = resultsByKey.get(workspace.key);
                if (resultForWorkspace?.retryTarget) {
                    return [{ ...workspace, retryTarget: resultForWorkspace.retryTarget } as PendingOpenCodeWorkspace];
                }
                return failedKeys.has(workspace.key) ? [workspace] : [];
            });
            const cleanupMessages = results.flatMap((entry) =>
                entry.cleanupFailures.map(({ error, path }) => (path ? `${path}: ${error}` : error)),
            );
            const failureMessages = [
                ...failures.map((failure) => `${failure.workspaceKey}: ${failure.error}`),
                ...cleanupMessages,
            ];
            if (failureMessages.length > 0) {
                setPartialDeleteError(
                    `Deletion completed with ${failureMessages.length} issue${failureMessages.length === 1 ? '' : 's'}: ${failureMessages.join('; ')}. Retry to attempt the remaining cleanup.`,
                );
                setPendingDelete(retryableWorkspaces);
                return;
            }

            setPartialDeleteError(null);
            setPendingDelete(null);
        },
    });

    const visibleWorkspaces = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [workspace.label, workspace.worktree, workspace.key, workspace.projectId]),
    );

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search workspace name or path"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Inventory"
                subtitle="Workspace groups are derived from the local OpenCode project, session, message, and part tables."
                title="OpenCode"
            />

            <OpenCodeWorkspacesTable
                onDeleteWorkspace={(workspace) => {
                    setPartialDeleteError(null);
                    setPendingDelete([workspace]);
                }}
                onDeleteWorkspaces={(selectedWorkspaces) => {
                    if (selectedWorkspaces.length > 0) {
                        setPartialDeleteError(null);
                        setPendingDelete(selectedWorkspaces);
                    }
                }}
                workspaces={visibleWorkspaces}
            />

            <DeleteConfirmDialog
                confirmLabel={
                    deleteWorkspaceMutation.isPending
                        ? 'Deleting...'
                        : pendingDelete?.length === 1
                          ? 'Delete workspace'
                          : 'Delete workspaces'
                }
                description={getWorkspaceDeleteDescription(pendingDelete)}
                errorMessage={
                    partialDeleteError ??
                    getMutationErrorMessage(deleteWorkspaceMutation.error, 'Workspace deletion failed')
                }
                open={pendingDelete !== null && pendingDelete.length > 0}
                title={pendingDelete?.length === 1 ? 'Delete OpenCode workspace?' : 'Delete OpenCode workspaces?'}
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteWorkspaceMutation.mutate(pendingDelete);
                    }
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPartialDeleteError(null);
                        setPendingDelete(null);
                        deleteWorkspaceMutation.reset();
                    }
                }}
            />
        </div>
    );
};

export const Route = createFileRoute('/opencode/')({
    component: OpenCodePage,
    errorComponent: OpenCodeErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(openCodeWorkspacesQueryOptions()),
    pendingComponent: () => (
        <LoadingPanel description="Loading OpenCode workspaces and database metadata." title="Loading OpenCode" />
    ),
    pendingMs: 0,
});
