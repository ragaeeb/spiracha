import type { WebChatImportError } from '@spiracha/lib/web-chat';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { WebChatDropzone } from '#/components/web-chat-dropzone';
import { WebConversationsTable } from '#/components/web-conversations-table';
import { matchesTextQuery } from '#/lib/text-filter';
import { webChatsQueryOptions } from '#/lib/web-chat-queries';
import { dedupeImportErrors, readImportFiles } from '#/lib/web-chat-import';
import { importWebChatsFn } from '#/lib/web-chat-server';

const WebPage = () => {
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const conversations = useSuspenseQuery(webChatsQueryOptions()).data;
    const [importErrors, setImportErrors] = useState<WebChatImportError[]>([]);
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);
    const visibleConversations = useMemo(
        () =>
            conversations.filter((conversation) =>
                matchesTextQuery(deferredSearch, [
                    conversation.title,
                    conversation.platform,
                    conversation.model,
                    conversation.fileName,
                    conversation.sourceConversationId,
                ]),
            ),
        [conversations, deferredSearch],
    );

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
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['web-chats'] }),
                ...result.conversations.flatMap((conversation) => [
                    queryClient.invalidateQueries({ queryKey: ['web-chat', conversation.id] }),
                    queryClient.invalidateQueries({ queryKey: ['web-chat-events', conversation.id] }),
                ]),
            ]);
            if (result.conversations.length === 1 && result.errors.length === 0) {
                await navigate({
                    params: { conversationId: result.conversations[0]!.id },
                    to: '/web-chats/$conversationId',
                });
            }
        },
    });

    const errorMessage = importMutation.isError
        ? importMutation.error instanceof Error
            ? importMutation.error.message
            : 'Web chat import failed.'
        : null;

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

            <WebConversationsTable conversations={visibleConversations} />
        </div>
    );
};

export const Route = createFileRoute('/web/')({
    component: WebPage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load web imports" />,
    loader: ({ context }) => context.queryClient.ensureQueryData(webChatsQueryOptions()),
    pendingComponent: () => <LoadingPanel description="Loading imported web conversations." title="Loading Web" />,
});
