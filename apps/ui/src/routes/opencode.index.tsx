import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { OpenCodeWorkspacesTable } from '#/components/opencode-workspaces-table';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { openCodeWorkspacesQueryOptions } from '#/lib/opencode-queries';
import { matchesTextQuery } from '#/lib/text-filter';

const OpenCodeErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load OpenCode workspaces" />;
};

const OpenCodePage = () => {
    const workspaces = useSuspenseQuery(openCodeWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);

    const visibleWorkspaces = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [workspace.label, workspace.worktree, workspace.key, workspace.projectId]),
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
                subtitle="Workspace groups are derived from the local OpenCode project, session, message, and part tables."
                title="OpenCode"
            />

            <OpenCodeWorkspacesTable workspaces={visibleWorkspaces} />
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
});
