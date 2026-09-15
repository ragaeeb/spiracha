import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { GrokBotChatsTable, grokBotChatKindLabel, grokBotMemberNames } from '#/components/grok-bot-chats-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import type { GrokBotChat } from '#/lib/grok-bot-server';
import {
    deleteGrokBotChatFn,
    deleteGrokBotChatsFn,
    exportGrokBotChatFn,
    exportGrokBotChatsFn,
    grokBotChatsQueryOptions,
} from '#/lib/grok-bot-server';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import { matchesTextQuery } from '#/lib/text-filter';

type PendingChatDelete = {
    chats: GrokBotChat[];
};

type PendingChatExport = {
    conversationIds: string[];
    label: string;
};

const buildChatExport = (selectedChats: GrokBotChat[]): PendingChatExport => ({
    conversationIds: selectedChats.map((chat) => chat.id),
    label:
        selectedChats.length === 1
            ? (selectedChats[0]!.title ?? selectedChats[0]!.id)
            : `${selectedChats.length} selected chats`,
});

const getDeleteConfirmLabel = (pendingDelete: PendingChatDelete | null, isPending: boolean) => {
    if (isPending) {
        return 'Deleting...';
    }
    return pendingDelete && pendingDelete.chats.length > 1 ? 'Delete chats' : 'Delete chat';
};

const getDeleteDescription = (pendingDelete: PendingChatDelete | null) => {
    if (!pendingDelete) {
        return 'Permanently delete the selected Grok Bot chats from local persistence. Quit Grok Bot and keep it stopped.';
    }
    if (pendingDelete.chats.length === 1) {
        return `Permanently delete "${pendingDelete.chats[0]!.title ?? pendingDelete.chats[0]!.id}" from local Grok Bot persistence. Quit Grok Bot and keep it stopped. This removes its roster entry and transcript replica.`;
    }
    return `Permanently delete ${pendingDelete.chats.length} selected Grok Bot chats from local persistence. Quit Grok Bot and keep it stopped. This removes their roster entries and transcript replicas.`;
};

const getDeleteTitle = (pendingDelete: PendingChatDelete | null) =>
    pendingDelete && pendingDelete.chats.length > 1
        ? `Delete ${pendingDelete.chats.length} Grok Bot chats?`
        : 'Delete this Grok Bot chat?';

const GrokBotPage = () => {
    const downloadCancellation = useDownloadCancellation();
    const queryClient = useQueryClient();
    const conversations = useSuspenseQuery(grokBotChatsQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingChatDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingChatExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);
    const visibleConversations = useMemo(
        () =>
            conversations.filter((conversation) =>
                matchesTextQuery(deferredSearch, [
                    conversation.title,
                    conversation.id,
                    grokBotChatKindLabel(conversation),
                    ...grokBotMemberNames(conversation),
                ]),
            ),
        [conversations, deferredSearch],
    );
    const visibleChatsById = useMemo(
        () => new Map(visibleConversations.map((conversation) => [conversation.id, conversation])),
        [visibleConversations],
    );
    const lookupSelectedChats = (conversationIds: string[]) =>
        conversationIds
            .map((conversationId) => visibleChatsById.get(conversationId) ?? null)
            .filter((conversation): conversation is GrokBotChat => conversation !== null);
    const openExportForChats = (selectedChats: GrokBotChat[]) => {
        if (selectedChats.length > 0) {
            setPendingExport(buildChatExport(selectedChats));
        }
    };
    const openDeleteForChats = (selectedChats: GrokBotChat[]) => {
        if (selectedChats.length > 0) {
            setPendingDelete({ chats: selectedChats });
        }
    };
    const exportMutation = useMutation({
        mutationFn: async ({ ids, options }: ExportSelectionMutationInput) => {
            const download =
                ids.length === 1
                    ? await exportGrokBotChatFn({
                          data: {
                              conversationId: ids[0]!,
                              includeCommentary: options.includeCommentary,
                              includeMetadata: options.includeMetadata,
                              includeTools: options.includeTools,
                              outputFormat: options.outputFormat,
                              zipArchive: options.zipArchive,
                          },
                      })
                    : await exportGrokBotChatsFn({
                          data: {
                              conversationIds: [...ids],
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

            await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl);
        },
        onSuccess: () => setPendingExport(null),
    });
    const deleteMutation = useMutation({
        mutationFn: async (conversationIds: string[]) =>
            conversationIds.length === 1
                ? deleteGrokBotChatFn({ data: { conversationId: conversationIds[0]! } })
                : deleteGrokBotChatsFn({ data: { conversationIds } }),
        onSettled: async (_result, _error, conversationIds) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['grok-bot-chats'] }),
                ...conversationIds.map((conversationId) =>
                    queryClient.invalidateQueries({ queryKey: ['grok-bot-chat', conversationId] }),
                ),
            ]);
        },
        onSuccess: () => setPendingDelete(null),
    });

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search chats, agents, or ids"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Global chats"
                subtitle="Conversations persisted by the installed Grok Bot macOS app."
                title="Grok Bot"
            />
            <GrokBotChatsTable
                chats={visibleConversations}
                onDeleteChat={(chat) => openDeleteForChats([chat])}
                onDeleteChats={(conversationIds) => openDeleteForChats(lookupSelectedChats(conversationIds))}
                onExportChat={(chat) => openExportForChats([chat])}
                onExportChats={(conversationIds) => openExportForChats(lookupSelectedChats(conversationIds))}
            />
            <ExportDialog
                errorMessage={getMutationErrorMessage(exportMutation.error, 'Chat export failed')}
                forceZipArchive={pendingExport ? pendingExport.conversationIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportMutation.isPending}
                rawExport={pendingExport ? { ids: pendingExport.conversationIds, source: 'grok-bot' } : undefined}
                title={pendingExport ? `Export ${pendingExport.label}` : 'Export chat'}
                onExport={(options) => {
                    if (pendingExport) {
                        exportMutation.mutate(
                            createExportSelectionMutationInput(pendingExport.conversationIds, options),
                        );
                    }
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingExport(null);
                        exportMutation.reset();
                    }
                }}
            />
            <DeleteConfirmDialog
                confirmLabel={getDeleteConfirmLabel(pendingDelete, deleteMutation.isPending)}
                description={getDeleteDescription(pendingDelete)}
                errorMessage={getMutationErrorMessage(deleteMutation.error, 'Chat delete failed')}
                open={pendingDelete !== null}
                title={getDeleteTitle(pendingDelete)}
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteMutation.mutate(pendingDelete.chats.map((chat) => chat.id));
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
};

export const Route = createFileRoute('/grok-bot/')({
    component: GrokBotPage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Grok Bot chats" />,
    loader: ({ context }) => context.queryClient.ensureQueryData(grokBotChatsQueryOptions()),
    pendingComponent: () => (
        <LoadingPanel description="Loading Grok Bot conversation metadata." title="Loading Grok Bot" />
    ),
    pendingMs: 0,
});
