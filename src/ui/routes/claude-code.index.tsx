import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ClaudeCodeWorkspacesTable } from '#/components/claude-code-workspaces-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { claudeCodeWorkspacesQueryOptions } from '#/lib/claude-code-queries';
import { matchesTextQuery } from '#/lib/text-filter';

export const Route = createFileRoute('/claude-code/')({
    component: ClaudeCodePage,
    errorComponent: ClaudeCodeErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(claudeCodeWorkspacesQueryOptions()),
    pendingComponent: () => (
        <LoadingPanel description="Loading Claude Code workspace and session metadata." title="Loading Claude Code" />
    ),
    pendingMs: 0,
});

function ClaudeCodeErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Claude Code workspaces" />;
}

function ClaudeCodePage() {
    const workspaces = useSuspenseQuery(claudeCodeWorkspacesQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);

    const visibleWorkspaces = workspaces.filter((workspace) =>
        matchesTextQuery(deferredSearch, [workspace.label, workspace.worktree, workspace.key, workspace.directoryName]),
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
                subtitle="Workspace groups are derived from local Claude Code project JSONL transcripts."
                title="Claude Code"
            />

            <ClaudeCodeWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
}
