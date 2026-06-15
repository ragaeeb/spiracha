import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { KiroWorkspacesTable } from '#/components/kiro-workspaces-table';
import { ListSearchInput } from '#/components/list-search-input';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { kiroWorkspacesQueryOptions } from '#/lib/kiro-queries';
import { matchesTextQuery } from '#/lib/text-filter';

export const Route = createFileRoute('/kiro/')({
    component: KiroPage,
    errorComponent: KiroErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(kiroWorkspacesQueryOptions()),
});

function KiroErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Kiro workspaces" />;
}

function KiroPage() {
    const workspaces = useSuspenseQuery(kiroWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);

    const visibleWorkspaces = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [workspace.label, workspace.worktree, workspace.key, workspace.directoryName]),
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
                subtitle="Workspace groups are derived from local Kiro workspace session files."
                title="Kiro"
            />

            <KiroWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
}
