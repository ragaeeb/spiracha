import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { CommandCodeWorkspacesTable } from '#/components/command-code-workspaces-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { commandCodeWorkspacesQueryOptions } from '#/lib/command-code-queries';
import { matchesTextQuery } from '#/lib/text-filter';

const CommandCodeErrorComponent = ({ error }: { error: unknown }) => (
    <RouteErrorPanel error={error} title="Failed to load Command Code workspaces" />
);

const CommandCodePage = () => {
    const workspaces = useSuspenseQuery(commandCodeWorkspacesQueryOptions()).data;
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
                subtitle="Workspace groups are derived from local Command Code session JSONL transcripts."
                title="Command Code"
            />
            <CommandCodeWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
};

export const Route = createFileRoute('/command-code/')({
    component: CommandCodePage,
    errorComponent: CommandCodeErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(commandCodeWorkspacesQueryOptions()),
    pendingComponent: () => (
        <LoadingPanel description="Loading Command Code workspace and session metadata." title="Loading Command Code" />
    ),
    pendingMs: 0,
});
