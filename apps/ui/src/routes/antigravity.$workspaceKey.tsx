import type { AntigravityConversation, AntigravityWorkspaceGroup } from '@spiracha/lib/antigravity-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { AntigravityConversationsTable } from '#/components/antigravity-conversations-table';
import { AntigravityKeychainPanel } from '#/components/antigravity-keychain-panel';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import {
    antigravityConversationsQueryOptions,
    antigravityDecryptionQueryOptions,
    antigravityWorkspacesQueryOptions,
} from '#/lib/antigravity-queries';
import {
    deleteAntigravityConversationFn,
    exportAntigravityArtifactsFn,
    exportAntigravityConversationFn,
} from '#/lib/antigravity-server';
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
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(antigravityWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const conversations = useSuspenseQuery(antigravityConversationsQueryOptions(workspace.key)).data;
    const decryptionState = useSuspenseQuery(antigravityDecryptionQueryOptions()).data ?? null;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<AntigravityConversation | null>(null);
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

    const deleteMutation = useMutation({
        mutationFn: async (conversation: AntigravityConversation) =>
            deleteAntigravityConversationFn({ data: { conversationId: conversation.conversationId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['antigravity-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['antigravity-conversations', workspace.key] }),
                pendingDelete
                    ? queryClient.invalidateQueries({
                          queryKey: ['antigravity-conversation', pendingDelete.conversationId],
                      })
                    : Promise.resolve(),
            ]);
            setPendingDelete(null);
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

            <AntigravityKeychainPanel />

            <AntigravityConversationsTable
                conversations={visibleConversations}
                decryptionState={decryptionState}
                onDeleteConversation={setPendingDelete}
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

            <DeleteConfirmDialog
                confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete conversation'}
                description={
                    pendingDelete
                        ? `Permanently delete "${pendingDelete.title}" from Antigravity history. This removes the summary entry, conversation file, transcript logs, and generated artifacts that belong to this conversation.`
                        : 'Permanently delete this Antigravity conversation from disk.'
                }
                errorMessage={
                    deleteMutation.isError
                        ? deleteMutation.error instanceof Error
                            ? deleteMutation.error.message
                            : 'Conversation delete failed'
                        : null
                }
                open={pendingDelete !== null}
                title="Delete this Antigravity conversation?"
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteMutation.mutate(pendingDelete);
                    }
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDelete(null);
                        deleteMutation.reset();
                    }
                }}
            />
        </div>
    );
}
