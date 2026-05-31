import type { AntigravityConversation, AntigravityWorkspaceGroup } from '@spiracha/lib/antigravity-exporter-types';
import type { AntigravityDecryptionState } from '@spiracha/lib/antigravity-keychain';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { AntigravityConversationsTable } from '#/components/antigravity-conversations-table';
import { AntigravityKeychainPanel } from '#/components/antigravity-keychain-panel';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import {
    antigravityConversationsQueryOptions,
    antigravityDecryptionQueryOptions,
    antigravityWorkspacesQueryOptions,
} from '#/lib/antigravity-queries';
import { exportAntigravityArtifactsFn, exportAntigravityConversationFn } from '#/lib/antigravity-server';
import { downloadTextFile } from '#/lib/download';
import { matchesTextQuery } from '#/lib/text-filter';

const findWorkspaceOrThrow = (workspaces: AntigravityWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Antigravity workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

export const Route = createFileRoute('/antigravity/$workspaceKey')({
    component: AntigravityWorkspacePage,
    errorComponent: AntigravityWorkspaceErrorComponent,
    loader: async ({ context, params }) => {
        const workspaces = await context.queryClient.ensureQueryData(antigravityWorkspacesQueryOptions());
        findWorkspaceOrThrow(workspaces, params.workspaceKey);
        await Promise.all([
            context.queryClient.ensureQueryData(antigravityDecryptionQueryOptions()),
            context.queryClient.ensureQueryData(antigravityConversationsQueryOptions(params.workspaceKey)),
        ]);
    },
    pendingComponent: () => (
        <LoadingPanel
            description="Loading Antigravity conversations, artifacts, and transcript availability."
            title="Loading workspace"
        />
    ),
});

function AntigravityWorkspaceErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Antigravity workspace" />;
}

function AntigravityWorkspacePage() {
    const params = Route.useParams();
    const workspaces = useSuspenseQuery(antigravityWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const conversations = useSuspenseQuery(antigravityConversationsQueryOptions(workspace.key)).data;
    const decryptionState = useSuspenseQuery(antigravityDecryptionQueryOptions()).data ?? null;
    const [searchInput, setSearchInput] = useState('');
    const [keychainState, setKeychainState] = useState<AntigravityDecryptionState | null>(decryptionState);
    const deferredSearch = useDeferredValue(searchInput);

    const exportConversationMutation = useMutation({
        mutationFn: (conversation: AntigravityConversation) =>
            exportAntigravityConversationFn({ data: { conversationId: conversation.conversationId } }),
        onSuccess: (result) => {
            downloadTextFile(result.filename, result.content, 'text/markdown; charset=utf-8');
        },
    });

    const exportArtifactsMutation = useMutation({
        mutationFn: (conversation: AntigravityConversation) =>
            exportAntigravityArtifactsFn({ data: { conversationId: conversation.conversationId } }),
        onSuccess: (result) => {
            downloadTextFile(result.filename, result.content, 'text/markdown; charset=utf-8');
        },
    });

    const visibleConversations = conversations.filter((conversation) =>
        matchesTextQuery(deferredSearch, [
            conversation.title,
            conversation.conversationId,
            conversation.transcriptSource,
            conversation.workspaceLabel,
        ]),
    );

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search title, id, or transcript source"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Antigravity workspace"
                subtitle="Inspect conversation coverage across Antigravity transcripts, raw payloads, and generated artifacts."
                title={workspace.label}
            />

            <AntigravityKeychainPanel onStateChange={setKeychainState} />

            <AntigravityConversationsTable
                conversations={visibleConversations}
                decryptionState={keychainState}
                onExportArtifacts={(conversation) => exportArtifactsMutation.mutate(conversation)}
                onExportConversation={(conversation) => exportConversationMutation.mutate(conversation)}
            />

            {exportConversationMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {exportConversationMutation.error instanceof Error
                        ? exportConversationMutation.error.message
                        : 'Conversation export failed'}
                </p>
            ) : null}

            {exportArtifactsMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {exportArtifactsMutation.error instanceof Error
                        ? exportArtifactsMutation.error.message
                        : 'Artifact export failed'}
                </p>
            ) : null}
        </div>
    );
}
