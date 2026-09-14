import type { CommandCodeWorkspaceGroup } from '@spiracha/lib/command-code-exporter-types';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { CommandCodeSessionsTable } from '#/components/command-code-sessions-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { commandCodeSessionsQueryOptions, commandCodeWorkspacesQueryOptions } from '#/lib/command-code-queries';
import { matchesTextQuery } from '#/lib/text-filter';

const findWorkspaceOrThrow = (workspaces: CommandCodeWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Command Code workspace not found: ${workspaceKey}`);
    }
    return workspace;
};

const CommandCodeWorkspacePage = () => {
    const params = Route.useParams();
    const workspaces = useSuspenseQuery(commandCodeWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const sessions = useSuspenseQuery(commandCodeSessionsQueryOptions(workspace.key)).data;
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);
    const visibleSessions = useMemo(
        () =>
            sessions.filter((session) =>
                matchesTextQuery(deferredSearch, [
                    session.title,
                    session.sessionId,
                    session.model,
                    session.modelLabel,
                    session.filePath,
                ]),
            ),
        [deferredSearch, sessions],
    );

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search session title, id, model, or file"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Command Code workspace"
                subtitle={workspace.worktree}
                title={workspace.label}
            />
            <CommandCodeSessionsTable sessions={visibleSessions} />
        </div>
    );
};

export const Route = createFileRoute('/command-code/$workspaceKey')({
    component: CommandCodeWorkspacePage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Command Code workspace" />,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(commandCodeWorkspacesQueryOptions());
        const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await context.queryClient.ensureQueryData(commandCodeSessionsQueryOptions(workspace.key));
    },
    pendingComponent: () => (
        <LoadingPanel description="Loading Command Code sessions and transcript metadata." title="Loading workspace" />
    ),
});
