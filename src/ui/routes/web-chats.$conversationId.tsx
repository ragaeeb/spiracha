import type { ThreadEvent } from '@spiracha/lib/conversation-data/conversation-events';
import type { WebChatConversationSummary } from '@spiracha/lib/web-chat';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Download, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { JsonPanel } from '#/components/json-panel';
import { LoadingPanel } from '#/components/loading-panel';
import { MetadataSection } from '#/components/metadata-section';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { TranscriptControls } from '#/components/transcript-controls';
import { TranscriptView } from '#/components/transcript-view';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { WebChatArtifacts } from '#/components/web-chat-artifacts';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import type { ExportDialogOptions, ExportLifecycleCallbacks } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import {
    getTranscriptDisplayState,
    parseThreadTranscriptSearch,
    type ThreadTranscriptSearch,
    withThreadTranscriptSearch,
} from '#/lib/route-search';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { invalidateSourceConversationQueries } from '#/lib/source-query-bindings';
import { getThreadTranscriptStats } from '#/lib/thread-transcript-stats';
import { useClientReady } from '#/lib/use-client-ready';
import { webChatArtifactsQueryOptions, webChatEventsQueryOptions, webChatQueryOptions } from '#/lib/web-chat-queries';
import { deleteWebChatFn, exportWebChatFn } from '#/lib/web-chat-server';

const buildConversationMetadata = (conversation: WebChatConversationSummary) => [
    { label: 'Parsed ID', value: <span data-mono="true">{conversation.id}</span> },
    { label: 'Source conversation ID', value: conversation.sourceConversationId ?? 'unknown' },
    { label: 'Platform', value: conversation.platform },
    { label: 'Model', value: conversation.model ?? 'unknown' },
    { label: 'Imported file', value: conversation.fileName },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(conversation.createdAtMs)}</span> },
    { label: 'Updated', value: <span suppressHydrationWarning>{formatDateTime(conversation.lastActiveAtMs)}</span> },
];

const buildTranscriptMetadata = (events: ThreadEvent[]) => {
    const stats = getThreadTranscriptStats(events);
    return [
        { label: 'Event kinds', value: formatList([...new Set(events.map((event) => event.kind))]) },
        { label: 'Messages', value: formatNumber(stats.messageCount) },
        { label: 'User messages', value: formatNumber(stats.userMessageCount) },
        { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
        { label: 'Reasoning events', value: formatNumber(events.filter((event) => event.kind === 'reasoning').length) },
    ];
};

const webQueryPanel = (
    query: { error: unknown; isError: boolean; isPending: boolean },
    pending: ReactNode,
    errorTitle: string,
    ready: ReactNode,
) => {
    if (query.isPending) {
        return pending;
    }
    if (query.isError) {
        return <RouteErrorPanel error={query.error} title={errorTitle} />;
    }
    return ready;
};

const transcriptStatsItems = (
    query: { isError: boolean; isPending: boolean },
    ready: ReturnType<typeof buildTranscriptMetadata>,
) => {
    if (query.isPending) {
        return [{ label: 'Transcript', value: 'Loading…' }];
    }
    if (query.isError) {
        return [{ label: 'Transcript', value: 'Failed to load.' }];
    }
    return ready;
};

const reasoningMetric = (pending: boolean, events: ThreadEvent[]) =>
    pending ? 'Loading…' : formatNumber(events.filter((event) => event.kind === 'reasoning').length);

const downloadWebChatExport = async (
    conversationId: string,
    options: ExportDialogOptions,
    cancellation: ReturnType<typeof useDownloadCancellation>,
) => {
    const download = await exportWebChatFn({
        data: {
            conversationId,
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

const WebChatDetailPage = () => {
    const navigate = useNavigate({ from: Route.fullPath });
    const downloadCancellation = useDownloadCancellation();
    const queryClient = useQueryClient();
    const conversationId = Route.useParams().conversationId;
    const conversation = useSuspenseQuery(webChatQueryOptions(conversationId)).data;
    const clientReady = useClientReady();
    const eventsQuery = useQuery({
        ...webChatEventsQueryOptions(conversationId),
        enabled: clientReady,
    });
    const events = eventsQuery.data ?? [];
    const artifactsQuery = useQuery({ ...webChatArtifactsQueryOptions(conversationId), enabled: clientReady });
    const transcriptSearch = Route.useSearch();
    const transcriptDisplay = getTranscriptDisplayState(transcriptSearch);
    const transcriptMetadata = useMemo(() => buildTranscriptMetadata(events), [events]);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const updateTranscriptDisplay = (patch: Partial<ThreadTranscriptSearch>) => {
        void navigate({
            replace: true,
            search: (previous: Record<string, unknown>) => withThreadTranscriptSearch(previous, patch),
        });
    };
    const exportMutation = useMutation({
        mutationFn: ({ options }: { callbacks: ExportLifecycleCallbacks; options: ExportDialogOptions }) =>
            downloadWebChatExport(conversationId, options, downloadCancellation),
        onSuccess: () => setExportOpen(false),
    });
    const deleteMutation = useMutation({
        mutationFn: () => deleteWebChatFn({ data: { conversationId } }),
        onSettled: async (_result, error) => {
            await invalidateSourceConversationQueries(queryClient, 'web', {
                ids: [conversationId],
                removeDetails: error == null,
            });
        },
        onSuccess: () => {
            setDeleteOpen(false);
            navigate({ to: '/web' });
        },
    });

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <>
                        <Button
                            className="rounded-full"
                            type="button"
                            variant="outline"
                            onClick={() => setExportOpen(true)}
                        >
                            <Download className="mr-2 size-4" />
                            Export
                        </Button>
                        <Button
                            className="rounded-full border-[var(--destructive)]/20 text-[var(--destructive)]"
                            type="button"
                            variant="outline"
                            onClick={() => setDeleteOpen(true)}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete
                        </Button>
                    </>
                }
                breadcrumb={<Breadcrumbs items={[{ label: 'Web', to: '/web' }, { label: conversation.title }]} />}
                eyebrow={`${conversation.platform} web chat`}
                subtitle={`Parsed from ${conversation.fileName}.`}
                title={conversation.title}
            />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(conversation.messageCount)} />
                <MetricCard label="Reasoning" value={reasoningMetric(eventsQuery.isPending, events)} />
                <MetricCard label="Platform" value={conversation.platform} />
                <MetricCard label="Model" value={conversation.model ?? 'unknown'} />
            </div>

            <Tabs className="space-y-3" defaultValue="transcript">
                <TabsList className="grid w-fit min-w-[20rem] grid-cols-4 rounded-full border border-[var(--border)] bg-[var(--panel)] p-1">
                    <TabsTrigger className="rounded-full px-5 text-sm" value="transcript">
                        Transcript
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-5 text-sm" value="metadata">
                        Metadata
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-5 text-sm" value="artifacts">
                        Artifacts
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-5 text-sm" value="raw">
                        Parsed JSON
                    </TabsTrigger>
                </TabsList>

                <TabsContent className="space-y-3" value="transcript">
                    {webQueryPanel(
                        eventsQuery,
                        <LoadingPanel description="Loading the parsed web transcript." title="Loading transcript" />,
                        'Failed to load web transcript',
                        <>
                            <TranscriptControls
                                rawJsonDisabled={events.length === 0}
                                showCommentary={transcriptDisplay.showCommentary}
                                showExtraEvents={transcriptDisplay.showExtraEvents}
                                showRawJson={transcriptDisplay.showRawJson}
                                showToolCalls={transcriptDisplay.showToolCalls}
                                showUserMessages={transcriptDisplay.showUserMessages}
                                onShowCommentaryChange={(value) => updateTranscriptDisplay({ commentary: value })}
                                onShowExtraEventsChange={(value) => updateTranscriptDisplay({ extra: value })}
                                onShowRawJsonChange={(value) => updateTranscriptDisplay({ raw: value })}
                                onShowToolCallsChange={(value) => updateTranscriptDisplay({ tools: value })}
                                onShowUserMessagesChange={(value) => updateTranscriptDisplay({ user: value })}
                            />
                            <TranscriptView
                                assistantModel={conversation.model}
                                events={events}
                                projectPath={null}
                                showCommentary={transcriptDisplay.showCommentary}
                                showExtraEvents={transcriptDisplay.showExtraEvents}
                                showRawJson={transcriptDisplay.showRawJson}
                                showToolCalls={transcriptDisplay.showToolCalls}
                                showUserMessages={transcriptDisplay.showUserMessages}
                            />
                        </>,
                    )}
                </TabsContent>

                <TabsContent value="artifacts">
                    {webQueryPanel(
                        artifactsQuery,
                        <LoadingPanel description="Loading generated documents." title="Loading artifacts" />,
                        'Failed to load artifacts',
                        <WebChatArtifacts artifacts={artifactsQuery.data ?? []} />,
                    )}
                </TabsContent>

                <TabsContent value="metadata">
                    <div className="grid gap-4 xl:grid-cols-2">
                        <MetadataSection
                            items={buildConversationMetadata(conversation)}
                            title="Conversation metadata"
                        />
                        <MetadataSection
                            items={transcriptStatsItems(eventsQuery, transcriptMetadata)}
                            title="Transcript stats"
                        />
                    </div>
                </TabsContent>

                <TabsContent value="raw">
                    {webQueryPanel(
                        eventsQuery,
                        <LoadingPanel
                            description="Loading normalized transcript events."
                            title="Loading parsed JSON"
                        />,
                        'Failed to load parsed JSON',
                        <JsonPanel title="Normalized imported conversation" value={{ ...conversation, events }} />,
                    )}
                </TabsContent>
            </Tabs>

            <ExportDialog
                errorMessage={getMutationErrorMessage(exportMutation.error, 'Chat export failed')}
                open={exportOpen}
                pending={exportMutation.isPending}
                title={`Export ${conversation.title}`}
                onExport={(options, callbacks) => exportMutation.mutate({ callbacks, options })}
                onOpenChange={(open) => {
                    setExportOpen(open);
                    if (!open) {
                        exportMutation.reset();
                    }
                }}
            />
            <DeleteConfirmDialog
                confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete chat'}
                description={`Remove "${conversation.title}" from this Spiracha process. The original provider export is not changed.`}
                errorMessage={getMutationErrorMessage(deleteMutation.error, 'Chat delete failed')}
                open={deleteOpen}
                title="Delete this imported chat?"
                onConfirm={() => deleteMutation.mutate()}
                onOpenChange={(open) => {
                    setDeleteOpen(open);
                    if (!open) {
                        deleteMutation.reset();
                    }
                }}
            />
        </div>
    );
};

export const Route = createFileRoute('/web-chats/$conversationId')({
    component: () => {
        const { conversationId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={conversationId}>
                <WebChatDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load web conversation" />,
    loader: ({ context, params }) => context.queryClient.ensureQueryData(webChatQueryOptions(params.conversationId)),
    pendingComponent: () => (
        <LoadingPanel description="Loading the parsed web conversation." title="Loading conversation" />
    ),
    validateSearch: parseThreadTranscriptSearch,
});
