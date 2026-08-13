import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ClineWorkspacesTable } from '#/components/cline-workspaces-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { clineWorkspacesQueryOptions } from '#/lib/cline-queries';
import { matchesTextQuery } from '#/lib/text-filter';

const ClinePage = () => {
    const workspaces = useSuspenseQuery(clineWorkspacesQueryOptions()).data;
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    const visible = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [workspace.label, workspace.worktree, workspace.key]),
    );
    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search workspace name or path"
                        value={search}
                        onValueChange={setSearch}
                    />
                }
                eyebrow="Inventory"
                subtitle="Chats are read from the Cline VS Code extension's global task storage."
                title="Cline"
            />
            <ClineWorkspacesTable workspaces={visible} />
        </div>
    );
};

export const Route = createFileRoute('/cline/')({
    component: ClinePage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Cline workspaces" />,
    loader: ({ context }) => context.queryClient.ensureQueryData(clineWorkspacesQueryOptions()),
    pendingComponent: () => <LoadingPanel description="Loading Cline chat metadata." title="Loading Cline" />,
});
