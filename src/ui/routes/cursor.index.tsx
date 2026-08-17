import type { CursorCleanupRetryTarget, CursorWorkspaceGroup } from '@spiracha/lib/cursor-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { CursorWorkspacesTable } from '#/components/cursor-workspaces-table';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { getCursorCleanupFailureMessage } from '#/lib/cursor-delete-result';
import { cursorWorkspacesQueryOptions } from '#/lib/cursor-queries';
import { deleteCursorWorkspaceFn, deleteCursorWorkspacesFn, recoverCursorWorkspaceFn } from '#/lib/cursor-server';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import { matchesTextQuery } from '#/lib/text-filter';

const CursorErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load Cursor workspaces" />;
};

const CursorPendingComponent = () => (
    <LoadingPanel description="Loading Cursor workspace and thread metadata." title="Loading Cursor" />
);

type PendingCursorWorkspace = CursorWorkspaceGroup & {
    retryTarget?: CursorCleanupRetryTarget;
};

const getWorkspaceDeleteDescription = (workspaces: CursorWorkspaceGroup[] | null) => {
    if (!workspaces || workspaces.length === 0) {
        return '';
    }

    if (workspaces.length === 1) {
        return `Permanently delete every thread for "${workspaces[0]!.label}" from Cursor's database, remove any on-disk transcript directories, and permanently delete local file history under the workspace folders. Quit Cursor first. This cannot be undone.`;
    }

    return `Permanently delete every thread from ${workspaces.length} selected Cursor workspaces, remove any on-disk transcript directories, and permanently delete local file history under the workspace folders. Quit Cursor first. This cannot be undone.`;
};

const CursorPage = () => {
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(cursorWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingCursorWorkspace[] | null>(null);
    const [partialDeleteError, setPartialDeleteError] = useState<string | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const invalidateCursorQueries = async () => {
        await queryClient.invalidateQueries({ queryKey: ['cursor-workspaces'] });
    };

    const recoverWorkspaceMutation = useMutation({
        mutationFn: (workspace: CursorWorkspaceGroup) =>
            recoverCursorWorkspaceFn({ data: { apply: true, workspaceKey: workspace.key } }),
        onSuccess: invalidateCursorQueries,
    });

    const deleteWorkspaceMutation = useMutation({
        mutationFn: async (selectedWorkspaces: PendingCursorWorkspace[]) => {
            const retryTargets = selectedWorkspaces.map((workspace) => workspace.retryTarget ?? null);
            if (selectedWorkspaces.length === 1) {
                const workspace = selectedWorkspaces[0]!;
                return [
                    await deleteCursorWorkspaceFn({
                        data: {
                            ...(workspace.retryTarget ? { retry: workspace.retryTarget } : {}),
                            workspaceKey: workspace.key,
                        },
                    }),
                ];
            }

            return deleteCursorWorkspacesFn({
                data: { retryTargets, workspaceKeys: selectedWorkspaces.map((workspace) => workspace.key) },
            });
        },
        onSettled: invalidateCursorQueries,
        onSuccess: (result, selectedWorkspaces) => {
            const cleanupError = getCursorCleanupFailureMessage(result);
            if (cleanupError) {
                setPartialDeleteError(cleanupError);
                const results = Array.isArray(result) ? result : [result];
                const retryableWorkspaces = selectedWorkspaces
                    .map((workspace, index) => ({ retryTarget: results[index]?.retryTarget, workspace }))
                    .filter(
                        (entry): entry is { retryTarget: CursorCleanupRetryTarget; workspace: CursorWorkspaceGroup } =>
                            entry.retryTarget !== undefined,
                    )
                    .map(({ retryTarget, workspace }) => ({ ...workspace, retryTarget }));
                if (retryableWorkspaces.length > 0) {
                    setPendingDelete(retryableWorkspaces);
                }
                return;
            }

            setPartialDeleteError(null);
            setPendingDelete(null);
        },
    });

    const visibleWorkspaces = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [
            workspace.label,
            workspace.uri,
            workspace.folders.join('\n'),
            workspace.kind,
        ]),
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
                subtitle="Workspace groups are derived from Cursor storage buckets and activity metadata. Open a workspace to inspect, export, recover, or delete its threads."
                title="Cursor"
            />

            <CursorWorkspacesTable
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
                onRecoverWorkspace={(workspace) => recoverWorkspaceMutation.mutate(workspace)}
                workspaces={visibleWorkspaces}
            />

            {recoverWorkspaceMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {recoverWorkspaceMutation.error instanceof Error
                        ? recoverWorkspaceMutation.error.message
                        : 'Workspace recovery failed'}
                </p>
            ) : null}

            {deleteWorkspaceMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {deleteWorkspaceMutation.error instanceof Error
                        ? deleteWorkspaceMutation.error.message
                        : 'Workspace deletion failed'}
                </p>
            ) : null}

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
                title={pendingDelete?.length === 1 ? 'Delete Cursor workspace?' : 'Delete Cursor workspaces?'}
                onConfirm={() => {
                    if (!pendingDelete) {
                        return;
                    }

                    setPartialDeleteError(null);
                    deleteWorkspaceMutation.mutate(pendingDelete);
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

export const Route = createFileRoute('/cursor/')({
    component: CursorPage,
    errorComponent: CursorErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(cursorWorkspacesQueryOptions()),
    pendingComponent: CursorPendingComponent,
    pendingMs: 0,
});
