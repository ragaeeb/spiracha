import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { FxWorkspacesTable } from '#/components/fx-workspaces-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { fxWorkspacesQueryOptions } from '#/lib/fx-queries';
import { matchesTextQuery } from '#/lib/text-filter';

const FxErrorComponent = ({ error }: { error: Error }) => (
    <RouteErrorPanel error={error} title="Failed to load FX workspaces" />
);

const FxPage = () => {
    const workspaces = useSuspenseQuery(fxWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);
    const visibleWorkspaces = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [workspace.label, workspace.worktree, workspace.key]),
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
                subtitle="Workspace groups are derived from local FX session checkpoints and event logs under ~/.fx/sessions."
                title="FX"
            />
            <FxWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
};

export const Route = createFileRoute('/fx/')({
    component: FxPage,
    errorComponent: FxErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(fxWorkspacesQueryOptions()),
    pendingComponent: () => (
        <LoadingPanel description="Loading FX workspace and session metadata." title="Loading FX" />
    ),
    pendingMs: 0,
});
