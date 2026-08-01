import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { MiniMaxCodeWorkspacesTable } from '#/components/minimax-code-workspaces-table';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { miniMaxCodeWorkspacesQueryOptions } from '#/lib/minimax-code-queries';
import { matchesTextQuery } from '#/lib/text-filter';

const MiniMaxCodeErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load MiniMax Code workspaces" />;
};

const MiniMaxCodePage = () => {
    const workspaces = useSuspenseQuery(miniMaxCodeWorkspacesQueryOptions()).data;
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
                subtitle="Workspace groups are derived from finalized MiniMax Code v2 session snapshots under ~/.minimax/v2/sessions."
                title="MiniMax Code"
            />
            <MiniMaxCodeWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
};

export const Route = createFileRoute('/minimax-code/')({
    component: MiniMaxCodePage,
    errorComponent: MiniMaxCodeErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(miniMaxCodeWorkspacesQueryOptions()),
    pendingComponent: () => (
        <LoadingPanel description="Loading MiniMax Code workspace and session metadata." title="Loading MiniMax Code" />
    ),
});
