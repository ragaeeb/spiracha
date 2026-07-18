import type { CursorWorkspaceGroup } from '@spiracha/lib/cursor-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { CursorWorkspacesTable } from '#/components/cursor-workspaces-table';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { cursorWorkspacesQueryOptions } from '#/lib/cursor-queries';
import { deleteCursorWorkspaceFn, recoverCursorWorkspaceFn } from '#/lib/cursor-server';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import { matchesTextQuery } from '#/lib/text-filter';

const CursorErrorComponent = ({ error }: { error: Error }) => {
    return <ReloadErrorPanel description={error.message} title="Failed to load Cursor workspaces" />;
};

const CursorPage = () => {
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(cursorWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<CursorWorkspaceGroup | null>(null);
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
        mutationFn: (workspace: CursorWorkspaceGroup) =>
            deleteCursorWorkspaceFn({ data: { workspaceKey: workspace.key } }),
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
        <div className="space-y-6">
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
                onDeleteWorkspace={setPendingDelete}
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
                confirmLabel={deleteWorkspaceMutation.isPending ? 'Deleting...' : 'Delete workspace'}
                description={
                    pendingDelete
                        ? `Permanently delete every thread for "${pendingDelete.label}" from Cursor's database and remove any on-disk transcript directories. Quit Cursor first. This cannot be undone.`
                        : ''
                }
                errorMessage={getMutationErrorMessage(deleteWorkspaceMutation.error, 'Workspace deletion failed')}
                open={pendingDelete !== null}
                title="Delete Cursor workspace?"
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
});
