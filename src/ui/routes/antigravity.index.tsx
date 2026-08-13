import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { AntigravityKeychainPanel } from '#/components/antigravity-keychain-panel';
import { AntigravityWorkspacesTable } from '#/components/antigravity-workspaces-table';
import { ListSearchInput } from '#/components/list-search-input';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { antigravityWorkspacesQueryOptions } from '#/lib/antigravity-queries';
import { matchesTextQuery } from '#/lib/text-filter';

export const Route = createFileRoute('/antigravity/')({
    component: AntigravityPage,
    errorComponent: AntigravityErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(antigravityWorkspacesQueryOptions()),
});

function AntigravityErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Antigravity workspaces" />;
}

function AntigravityPage() {
    const workspaces = useSuspenseQuery(antigravityWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);

    const visibleWorkspaces = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [workspace.label, workspace.uri, workspace.key]),
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
                subtitle="Workspace groups are derived from Antigravity summary indexes, raw conversation files, local logs, and brain artifacts."
                title="Antigravity"
            />

            <AntigravityKeychainPanel />

            <AntigravityWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
}
