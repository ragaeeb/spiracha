import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { GrokWorkspacesTable } from '#/components/grok-workspaces-table';
import { ListSearchInput } from '#/components/list-search-input';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { grokWorkspacesQueryOptions } from '#/lib/grok-queries';
import { matchesTextQuery } from '#/lib/text-filter';

const GrokErrorComponent = ({ error }: { error: Error }) => {
    return <ReloadErrorPanel description={error.message} title="Failed to load Grok workspaces" />;
};

const GrokPage = () => {
    const workspaces = useSuspenseQuery(grokWorkspacesQueryOptions()).data;
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
                subtitle="Workspace groups are derived from local Grok CLI session directories under ~/.grok/sessions."
                title="Grok"
            />

            <GrokWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
};

export const Route = createFileRoute('/grok/')({
    component: GrokPage,
    errorComponent: GrokErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(grokWorkspacesQueryOptions()),
});
