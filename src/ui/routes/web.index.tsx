import type { WebChatConversationSummary, WebChatImportError } from '@spiracha/lib/web-chat';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { WebChatDropzone } from '#/components/web-chat-dropzone';
import { WebConversationsTable } from '#/components/web-conversations-table';
import { conversationListSelection, lookupSelectedItems } from '#/lib/conversation-selection';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import { createExportSelectionMutationInput, type ExportSelectionMutationInput } from '#/lib/export-mutation';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import { invalidateSourceConversationQueries } from '#/lib/source-query-bindings';
import { matchesTextQuery } from '#/lib/text-filter';
import { dedupeImportErrors, readImportFiles } from '#/lib/web-chat-import';
import { webChatsQueryOptions } from '#/lib/web-chat-queries';
import {
    deleteWebChatFn,
    deleteWebChatsFn,
    exportWebChatFn,
    exportWebChatsFn,
    importWebChatsFn,
} from '#/lib/web-chat-server';

type PendingChatDelete = {
    chats: WebChatConversationSummary[];
};

type PendingChatExport = {
    conversationIds: string[];
    label: string;
};

const buildChatExport = (selectedChats: WebChatConversationSummary[]): PendingChatExport => ({
    conversationIds: selectedChats.map((chat) => chat.id),
    label: selectedChats.length === 1 ? selectedChats[0]!.title : `${selectedChats.length} selected chats`,
});

const filterWebConversations = (conversations: WebChatConversationSummary[], query: string) =>
    conversations.filter((conversation) =>
        matchesTextQuery(query, [
            conversation.title,
            conversation.platform,
            conversation.model,
            conversation.fileName,
            conversation.sourceConversationId,
            conversation.id,
        ]),
    );

const lookupVisibleChats = (conversations: WebChatConversationSummary[], conversationIds: string[]) =>
    lookupSelectedItems(conversationIds, conversations, (conversation) => conversation.id);

const downloadWebExport = async (
    ids: readonly string[],
    options: ExportSelectionMutationInput['options'],
    cancellation: ReturnType<typeof useDownloadCancellation>,
) => {
    const download =
        ids.length === 1
            ? await exportWebChatFn({
                  data: {
                      conversationId: ids[0]!,
                      includeCommentary: options.includeCommentary,
                      includeMetadata: options.includeMetadata,
                      includeTools: options.includeTools,
                      outputFormat: options.outputFormat,
                      zipArchive: options.zipArchive,
                  },
              })
            : await exportWebChatsFn({
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
    await downloadUrlFileWithCancellation(cancellation, download.fileName, download.downloadUrl);
};

const webDeleteCopy = (pendingDelete: PendingChatDelete | null, isPending: boolean) => {
    const count = pendingDelete?.chats.length ?? 0;
    const title = count > 1 ? `Delete ${count} imported chats?` : 'Delete this imported chat?';
    const confirmLabel = isPending ? 'Deleting...' : count > 1 ? 'Delete chats' : 'Delete chat';
    const description =
        count === 1
            ? `Remove "${pendingDelete!.chats[0]!.title}" from this Spiracha process. The original provider export is not changed.`
            : count > 1
              ? `Remove ${count} imported chats from this Spiracha process. Original provider exports are not changed.`
              : 'Remove the selected imported chats from this Spiracha process.';
    return { confirmLabel, description, title };
};

const WebPage = () => {
    const navigate = useNavigate({ from: Route.fullPath });
    const downloadCancellation = useDownloadCancellation();
    const queryClient = useQueryClient();
    const conversations = useSuspenseQuery(webChatsQueryOptions()).data;
    const [importErrors, setImportErrors] = useState<WebChatImportError[]>([]);
    const [searchInput, setSearchInput] = useState('');
    const [pendingDelete, setPendingDelete] = useState<PendingChatDelete | null>(null);
    const [pendingExport, setPendingExport] = useState<PendingChatExport | null>(null);
    const deferredSearch = useDeferredValue(searchInput);
    const visibleConversations = useMemo(
        () => filterWebConversations(conversations, deferredSearch),
        [conversations, deferredSearch],
    );
    const openExportForChats = (selectedChats: WebChatConversationSummary[]) => {
        if (selectedChats.length > 0) {
            setPendingExport(buildChatExport(selectedChats));
        }
    };
    const openDeleteForChats = (selectedChats: WebChatConversationSummary[]) => {
        if (selectedChats.length > 0) {
            setPendingDelete({ chats: selectedChats });
        }
    };

    const importMutation = useMutation({
        mutationFn: async (files: File[]) => {
            const prepared = await readImportFiles(files);
            if (prepared.payload.length === 0) {
                return { conversations: [], errors: prepared.errors };
            }
            const result = await importWebChatsFn({ data: { files: prepared.payload } });
            return { conversations: result.conversations, errors: [...prepared.errors, ...result.errors] };
        },
        onSuccess: async (result) => {
            setImportErrors(dedupeImportErrors(result.errors));
            await invalidateSourceConversationQueries(queryClient, 'web', {
                ids: result.conversations.map((conversation) => conversation.id),
            });
            if (result.conversations.length === 1 && result.errors.length === 0) {
                await navigate({
                    params: { conversationId: result.conversations[0]!.id },
                    to: '/web-chats/$conversationId',
                });
            }
        },
    });
    const exportMutation = useMutation({
        mutationFn: ({ ids, options }: ExportSelectionMutationInput) =>
            downloadWebExport(ids, options, downloadCancellation),
        onSuccess: () => setPendingExport(null),
    });
    const deleteMutation = useMutation({
        mutationFn: async (conversationIds: string[]) =>
            conversationIds.length === 1
                ? deleteWebChatFn({ data: { conversationId: conversationIds[0]! } })
                : deleteWebChatsFn({ data: { conversationIds } }),
        onSettled: async (_result, error, conversationIds) => {
            await invalidateSourceConversationQueries(queryClient, 'web', {
                ids: conversationIds,
                removeDetails: error == null,
            });
        },
        onSuccess: () => setPendingDelete(null),
    });
    const deleteCopy = webDeleteCopy(pendingDelete, deleteMutation.isPending);
    const errorMessage = getMutationErrorMessage(importMutation.error, 'Web chat import failed.');

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    conversations.length > 0 ? (
                        <ListSearchInput
                            placeholder="Search title, platform, model, or file"
                            value={searchInput}
                            onValueChange={setSearchInput}
                        />
                    ) : undefined
                }
                eyebrow="Web imports"
                subtitle="Drop JSON exports from ChatGPT, Claude, Gemini, Grok, Qwen, GLM, and compatible web chats. Imports stay available until this Spiracha server stops."
                title="Web"
            />

            <WebChatDropzone
                disabled={importMutation.isPending}
                onFiles={(files) => {
                    setImportErrors([]);
                    importMutation.mutate(files);
                }}
            />

            {errorMessage || importErrors.length > 0 ? (
                <section
                    aria-live="polite"
                    className="rounded-xl border border-[var(--destructive)]/30 bg-[var(--panel)] p-4 text-sm"
                    role="alert"
                >
                    <h2 className="font-semibold text-[var(--destructive)]">Some chats could not be imported</h2>
                    {errorMessage ? <p className="mt-2">{errorMessage}</p> : null}
                    {importErrors.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                            {importErrors.map((error) => (
                                <li key={`${error.fileName}-${error.message}`}>
                                    <span className="font-medium">{error.fileName}:</span> {error.message}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </section>
            ) : null}

            <WebConversationsTable
                {...conversationListSelection(
                    'web',
                    conversations.map((conversation) => conversation.id),
                )}
                conversations={visibleConversations}
                onDeleteChat={(chat) => openDeleteForChats([chat])}
                onDeleteChats={(conversationIds) =>
                    openDeleteForChats(lookupVisibleChats(conversations, conversationIds))
                }
                onExportChat={(chat) => openExportForChats([chat])}
                onExportChats={(conversationIds) =>
                    openExportForChats(lookupVisibleChats(conversations, conversationIds))
                }
            />
            <ExportDialog
                errorMessage={getMutationErrorMessage(exportMutation.error, 'Chat export failed')}
                forceZipArchive={pendingExport ? pendingExport.conversationIds.length > 1 : false}
                open={pendingExport !== null}
                pending={exportMutation.isPending}
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
                confirmLabel={deleteCopy.confirmLabel}
                description={deleteCopy.description}
                errorMessage={getMutationErrorMessage(deleteMutation.error, 'Chat delete failed')}
                open={pendingDelete !== null}
                title={deleteCopy.title}
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

export const Route = createFileRoute('/web/')({
    component: WebPage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load web imports" />,
    loader: ({ context }) => context.queryClient.ensureQueryData(webChatsQueryOptions()),
    pendingComponent: () => <LoadingPanel description="Loading imported web conversations." title="Loading Web" />,
});
