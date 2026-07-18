import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ListSearchInput } from '#/components/list-search-input';
import { PageHeader } from '#/components/page-header';
import { QoderWorkspacesTable } from '#/components/qoder-workspaces-table';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { qoderWorkspacesQueryOptions } from '#/lib/qoder-queries';
import { matchesTextQuery } from '#/lib/text-filter';

const QoderErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load Qoder workspaces" />;
};

const QoderPage = () => {
    const workspaces = useSuspenseQuery(qoderWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);

    const visibleWorkspaces = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [workspace.label, workspace.worktree, workspace.key]),
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
                subtitle="Workspace groups are derived from local Qoder history and workspace data."
                title="Qoder"
            />

            <QoderWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
};

export const Route = createFileRoute('/qoder/')({
    component: QoderPage,
    errorComponent: QoderErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(qoderWorkspacesQueryOptions()),
});
