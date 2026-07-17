import type { AntigravityConversation, AntigravityWorkspaceGroup } from '@spiracha/lib/antigravity-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { AntigravityConversationsTable } from '#/components/antigravity-conversations-table';
import { AntigravityKeychainPanel } from '#/components/antigravity-keychain-panel';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { Button } from '#/components/ui/button';
import {
    antigravityConversationsQueryOptions,
    antigravityDecryptionQueryOptions,
    antigravityWorkspacesQueryOptions,
} from '#/lib/antigravity-queries';
import {
    deleteAntigravityConversationFn,
    deleteAntigravityConversationsFn,
    exportAntigravityArtifactsFn,
    exportAntigravityConversationsFn,
} from '#/lib/antigravity-server';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { matchesTextQuery } from '#/lib/text-filter';
import { isWorkspaceEmptiedByDelete } from '#/lib/workspace-delete-navigation';

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

type PendingConversationDelete = {
    conversations: AntigravityConversation[];
    scope: 'all' | 'selected';
};

type PendingConversationExport = {
    conversationIds: string[];
    label: string;
    supportsTranscriptFilters: boolean;
};

const findWorkspaceOrThrow = (workspaces: AntigravityWorkspaceGroup[], workspaceKey: string) => {
    const workspace = workspaces.find((candidate) => candidate.key === workspaceKey);
    if (!workspace) {
        throw new Error(`Antigravity workspace not found: ${workspaceKey}`);
    }

    return workspace;
};

const buildConversationExport = (selectedConversations: AntigravityConversation[]): PendingConversationExport => ({
    conversationIds: selectedConversations.map((conversation) => conversation.conversationId),
    label:
        selectedConversations.length === 1
            ? selectedConversations[0]!.title
            : `${selectedConversations.length} selected conversations`,
    supportsTranscriptFilters: selectedConversations.every(
        (conversation) => conversation.transcriptSource !== 'safe-storage',
    ),
});

const getDeleteConfirmLabel = (pendingDelete: PendingConversationDelete | null, isPending: boolean) => {
    if (isPending) {
        return 'Deleting...';
    }

    if (pendingDelete?.scope === 'all') {
        return 'Delete all';
    }

    return pendingDelete && pendingDelete.conversations.length > 1 ? 'Delete conversations' : 'Delete conversation';
};

const getDeleteDescription = (pendingDelete: PendingConversationDelete | null) => {
    if (!pendingDelete) {
        return 'Permanently delete the selected Antigravity conversations from disk.';
    }

    if (pendingDelete.scope === 'all') {
        return `Permanently delete all ${pendingDelete.conversations.length} Antigravity conversations in this workspace from disk. This removes their summaries, conversation files, transcript logs, and generated artifacts.`;
    }

    if (pendingDelete.conversations.length === 1) {
        return `Permanently delete "${pendingDelete.conversations[0]!.title}" from Antigravity history. This removes the summary entry, conversation file, transcript logs, and generated artifacts that belong to this conversation.`;
    }

    return `Permanently delete ${pendingDelete.conversations.length} selected Antigravity conversations from disk. This removes their summaries, conversation files, transcript logs, and generated artifacts.`;
};

const getDeleteTitle = (pendingDelete: PendingConversationDelete | null) => {
    if (pendingDelete?.scope === 'all') {
        return `Delete all ${pendingDelete.conversations.length} Antigravity conversations?`;
    }

    return pendingDelete && pendingDelete.conversations.length > 1
        ? `Delete ${pendingDelete.conversations.length} Antigravity conversations?`
        : 'Delete this Antigravity conversation?';
};

const AntigravityWorkspaceErrors = ({ artifactError }: { artifactError: Error | null }) => {
    if (!artifactError) {
        return null;
    }

    return <p className="text-[var(--destructive)] text-sm">{artifactError.message}</p>;
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
    const navigate = useNavigate({ from: Route.fullPath });
    const params = Route.useParams();
    const queryClient = useQueryClient();
    const workspaces = useSuspenseQuery(antigravityWorkspacesQueryOptions()).data;
    const workspace = findWorkspaceOrThrow(workspaces, params.workspaceKey);
    const conversations = useSuspenseQuery(antigravityConversationsQueryOptions(workspace.key)).data;
    const decryptionState = useSuspenseQuery(antigravityDecryptionQueryOptions()).data ?? null;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingConversationDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingConversationExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);

    const exportArtifactsMutation = useMutation({
        mutationFn: (conversation: AntigravityConversation) =>
            exportAntigravityArtifactsFn({ data: { conversationId: conversation.conversationId } }),
        onSuccess: (result) => {
            downloadTextFile(result.filename, result.content, 'text/markdown; charset=utf-8');
        },
    });

    const exportConversationsMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!pendingExport) {
                throw new Error('No Antigravity conversation selected for export');
            }

            const download = await exportAntigravityConversationsFn({
                data: {
                    conversationIds: pendingExport.conversationIds,
                    includeCommentary: options.includeCommentary,
                    includeMetadata: options.includeMetadata,
                    includeTools: options.includeTools,
                    outputFormat: options.outputFormat,
                    zipArchive: options.zipArchive,
                },
            });

            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
                return;
            }

            await downloadUrlFile(download.fileName, download.downloadUrl);
        },
        onSuccess: () => {
            setPendingExport(null);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (conversationIds: string[]) =>
            conversationIds.length === 1
                ? deleteAntigravityConversationFn({ data: { conversationId: conversationIds[0]! } })
                : deleteAntigravityConversationsFn({ data: { conversationIds } }),
        onSuccess: async (result) => {
            const conversationIds = result.deletedConversationIds;
            const workspaceEmptied = isWorkspaceEmptiedByDelete(
                conversations,
                conversationIds,
                (conversation) => conversation.conversationId,
            );
            setPendingDelete(null);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['antigravity-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['antigravity-conversations', workspace.key] }),
                ...conversationIds.map((conversationId) =>
                    queryClient.invalidateQueries({
                        queryKey: ['antigravity-conversation', conversationId],
                    }),
                ),
            ]);
            if (workspaceEmptied) {
                await navigate({ to: '/antigravity' });
            }
        },
    });

    const visibleConversations = useMemo(
        () =>
            conversations.filter((conversation) =>
                matchesTextQuery(deferredSearch, [
                    conversation.title,
                    conversation.conversationId,
                    conversation.transcriptSource,
                    conversation.workspaceLabel,
                ]),
            ),
        [conversations, deferredSearch],
    );
    const visibleConversationsById = useMemo(
        () => new Map(visibleConversations.map((conversation) => [conversation.conversationId, conversation])),
        [visibleConversations],
    );
    const lookupSelectedConversations = (conversationIds: string[]) =>
        conversationIds
            .map((conversationId) => visibleConversationsById.get(conversationId) ?? null)
            .filter((conversation): conversation is AntigravityConversation => conversation !== null);
    const openExportForConversations = (selectedConversations: AntigravityConversation[]) => {
        if (selectedConversations.length === 0) {
            return;
        }

        setPendingExport(buildConversationExport(selectedConversations));
    };
    const openDeleteForConversations = (
        selectedConversations: AntigravityConversation[],
        scope: PendingConversationDelete['scope'],
    ) => {
        if (selectedConversations.length > 0) {
            setPendingDelete({ conversations: selectedConversations, scope });
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                            className="rounded-full"
                            disabled={deleteMutation.isPending || conversations.length === 0}
                            type="button"
                            variant="destructive"
                            onClick={() => openDeleteForConversations(conversations, 'all')}
                        >
                            <Trash2 className="size-4" />
                            Delete all
                        </Button>
                        <ListSearchInput
                            placeholder="Search title, id, or transcript source"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    </div>
                }
                eyebrow="Antigravity workspace"
                subtitle="Inspect conversation coverage across Antigravity transcripts, raw payloads, and generated artifacts."
                title={workspace.label}
            />

            <AntigravityKeychainPanel />

            <AntigravityConversationsTable
                conversations={visibleConversations}
                decryptionState={decryptionState}
                onDeleteConversation={(conversation) => openDeleteForConversations([conversation], 'selected')}
                onDeleteConversations={(conversationIds) =>
                    openDeleteForConversations(lookupSelectedConversations(conversationIds), 'selected')
                }
                onExportArtifacts={(conversation) => exportArtifactsMutation.mutate(conversation)}
                onExportConversation={(conversation) => openExportForConversations([conversation])}
                onExportConversations={(conversationIds) =>
                    openExportForConversations(lookupSelectedConversations(conversationIds))
                }
            />

            <AntigravityWorkspaceErrors
                artifactError={exportArtifactsMutation.isError ? exportArtifactsMutation.error : null}
            />

            <ExportDialog
                errorMessage={
                    exportConversationsMutation.isError
                        ? exportConversationsMutation.error instanceof Error
                            ? exportConversationsMutation.error.message
                            : 'Conversation export failed'
                        : null
                }
                forceZipArchive={pendingExport ? pendingExport.conversationIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportConversationsMutation.isPending}
                showCommentaryOption={pendingExport?.supportsTranscriptFilters ?? true}
                showToolsOption={pendingExport?.supportsTranscriptFilters ?? true}
                title={pendingExport ? `Export ${pendingExport.label}` : 'Export conversation'}
                onExport={(options) => exportConversationsMutation.mutate(options)}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingExport(null);
                        exportConversationsMutation.reset();
                    }
                }}
            />

            <DeleteConfirmDialog
                confirmLabel={getDeleteConfirmLabel(pendingDelete, deleteMutation.isPending)}
                description={getDeleteDescription(pendingDelete)}
                errorMessage={
                    deleteMutation.isError
                        ? deleteMutation.error instanceof Error
                            ? deleteMutation.error.message
                            : 'Conversation delete failed'
                        : null
                }
                open={pendingDelete !== null}
                title={getDeleteTitle(pendingDelete)}
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteMutation.mutate(
                            pendingDelete.conversations.map((conversation) => conversation.conversationId),
                        );
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
