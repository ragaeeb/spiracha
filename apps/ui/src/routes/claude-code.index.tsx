import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { ClaudeCodeWorkspacesTable } from '#/components/claude-code-workspaces-table';
import { ListSearchInput } from '#/components/list-search-input';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { claudeCodeWorkspacesQueryOptions } from '#/lib/claude-code-queries';
import { matchesTextQuery } from '#/lib/text-filter';

export const Route = createFileRoute('/claude-code/')({
    component: ClaudeCodePage,
    errorComponent: ClaudeCodeErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(claudeCodeWorkspacesQueryOptions()),
});

function ClaudeCodeErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Claude Code workspaces" />;
}

function ClaudeCodePage() {
    const workspaces = useSuspenseQuery(claudeCodeWorkspacesQueryOptions()).data;
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
                subtitle="Workspace groups are derived from local Claude Code project JSONL transcripts."
                title="Claude Code"
            />

            <ClaudeCodeWorkspacesTable workspaces={visibleWorkspaces} />
        </div>
    );
}
