import type { CursorWorkspaceGroup } from '@spiracha/lib/cursor-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { CursorWorkspacesTable } from '#/components/cursor-workspaces-table';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
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

const getWorkspaceDeleteDescription = (workspaces: CursorWorkspaceGroup[] | null) => {
    if (!workspaces) {
        return '';
    }

    if (workspaces.length === 1) {
        return `Permanently delete every thread for "${workspaces[0]!.label}" from Cursor's database and remove any on-disk transcript directories. Quit Cursor first. This cannot be undone.`;
    }

    return `Permanently delete every thread from ${workspaces.length} selected Cursor workspaces and remove any on-disk transcript directories. Quit Cursor first. This cannot be undone.`;
};

const CursorPage = () => {
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(cursorWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<CursorWorkspaceGroup[] | null>(null);
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
        mutationFn: async (selectedWorkspaces: CursorWorkspaceGroup[]) => {
            if (selectedWorkspaces.length === 1) {
                return [await deleteCursorWorkspaceFn({ data: { workspaceKey: selectedWorkspaces[0]!.key } })];
            }

            return deleteCursorWorkspacesFn({
                data: { workspaceKeys: selectedWorkspaces.map((workspace) => workspace.key) },
            });
        },
        onSuccess: async () => {
            await invalidateCursorQueries();
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
                onDeleteWorkspace={(workspace) => setPendingDelete([workspace])}
                onDeleteWorkspaces={setPendingDelete}
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
                errorMessage={getMutationErrorMessage(deleteWorkspaceMutation.error, 'Workspace deletion failed')}
                open={pendingDelete !== null}
                title={pendingDelete?.length === 1 ? 'Delete Cursor workspace?' : 'Delete Cursor workspaces?'}
                onConfirm={() => {
                    if (!pendingDelete) {
                        return;
                    }

                    deleteWorkspaceMutation.mutate(pendingDelete);
                }}
                onOpenChange={(open) => {
                    if (!open) {
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
