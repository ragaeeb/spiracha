import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { ConversationDetail } from '@spiracha/lib/conversation-data/types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Download, Trash2 } from 'lucide-react';
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
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import type { ExportDialogOptions, ExportLifecycleCallbacks } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { deleteGrokBotChatFn, exportGrokBotChatFn, grokBotChatQueryOptions } from '#/lib/grok-bot-server';
import { getGrokBotThreadTranscriptStats, grokBotMessagesToThreadEvents } from '#/lib/grok-bot-transcript-events';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import {
    getTranscriptDisplayState,
    parseThreadTranscriptSearch,
    type ThreadTranscriptSearch,
    withThreadTranscriptSearch,
} from '#/lib/route-search';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';

const getChatKind = (conversation: ConversationDetail) =>
    conversation.metadata.chatKind === 'group' ? 'Group' : '1:1';

const getMemberNames = (conversation: ConversationDetail) => {
    const members = conversation.metadata.members;
    return Array.isArray(members)
        ? members.flatMap((member) => {
              if (typeof member !== 'object' || member === null || Array.isArray(member)) {
                  return [];
              }
              const name = (member as Record<string, unknown>).name;
              return typeof name === 'string' && name.trim() ? [name] : [];
          })
        : [];
};

const getStringList = (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const buildChatMetadata = (conversation: ConversationDetail) => [
    { label: 'Conversation ID', value: <span data-mono="true">{conversation.id}</span> },
    { label: 'Type', value: getChatKind(conversation) },
    { label: 'Participants', value: getMemberNames(conversation).join(', ') || 'n/a' },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(conversation.createdAtMs)}</span> },
    { label: 'Updated', value: <span suppressHydrationWarning>{formatDateTime(conversation.updatedAtMs)}</span> },
    { label: 'Native deep link', value: conversation.deepLinks.native ?? 'Not exposed by Grok Bot' },
];

const buildTranscriptStatsItems = (
    conversation: ConversationDetail,
    events: ThreadEvent[],
    stats: ThreadTranscriptStats,
) => [
    { label: 'Event kinds', value: formatList([...new Set(events.map((event) => event.kind))]) },
    {
        label: 'Source entry kinds',
        value: formatList(getStringList(conversation.metadata.sourceEntryKinds)),
    },
    { label: 'Messages', value: formatNumber(stats.messageCount) },
    { label: 'User messages', value: formatNumber(stats.userMessageCount) },
    { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
    { label: 'Reasoning events', value: formatNumber(events.filter((event) => event.kind === 'reasoning').length) },
    { label: 'Final answers', value: formatNumber(stats.finalAnswerCount) },
    { label: 'Tool calls', value: formatNumber(stats.toolCallCount) },
    { label: 'Tool outputs', value: formatNumber(stats.toolOutputCount) },
    {
        label: 'Attachment descriptors',
        value: formatNumber(
            Array.isArray(conversation.metadata.attachments) ? conversation.metadata.attachments.length : 0,
        ),
    },
];

const GrokBotRawPanels = ({ conversation, events }: { conversation: ConversationDetail; events: ThreadEvent[] }) => (
    <div className="space-y-4">
        <JsonPanel title="Normalized chat" value={conversation} />
        <JsonPanel title="Transcript events" value={events} />
    </div>
);

const GrokBotChatPage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const conversationId = Route.useParams().conversationId;
    const transcriptSearch = Route.useSearch();
    const transcriptDisplay = getTranscriptDisplayState(transcriptSearch);
    const conversation = useSuspenseQuery(grokBotChatQueryOptions(conversationId)).data;
    const transcriptEvents = useMemo(
        () => grokBotMessagesToThreadEvents(conversation.messages),
        [conversation.messages],
    );
    const transcriptStats = useMemo(() => getGrokBotThreadTranscriptStats(transcriptEvents), [transcriptEvents]);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const updateTranscriptDisplay = (patch: Partial<ThreadTranscriptSearch>) => {
        void navigate({
            replace: true,
            search: (previous: Record<string, unknown>) => withThreadTranscriptSearch(previous, patch),
        });
    };

    const exportMutation = useMutation({
        mutationFn: async ({
            options,
            callbacks,
        }: {
            callbacks: ExportLifecycleCallbacks;
            options: ExportDialogOptions;
        }) => {
            const download = await exportGrokBotChatFn({
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
                downloadTextFile(download.fileName, download.content, download.mimeType, {
                    onStateChange: callbacks.onDownloadStateChange,
                });
                return;
            }

            await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl, {
                onStateChange: callbacks.onDownloadStateChange,
            });
        },
        onSuccess: () => setExportOpen(false),
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteGrokBotChatFn({ data: { conversationId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['grok-bot-chats'] }),
                queryClient.invalidateQueries({ queryKey: ['grok-bot-chat', conversationId] }),
            ]);
            navigate({ to: '/grok-bot' });
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
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'Grok Bot', to: '/grok-bot' },
                            { label: conversation.title ?? conversation.id },
                        ]}
                    />
                }
                eyebrow={`${getChatKind(conversation)} Grok Bot chat`}
                subtitle="Conversation detail for the selected persisted Grok Bot chat."
                title={conversation.title ?? conversation.id}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(transcriptStats.messageCount)} />
                <MetricCard label="Tool calls" value={formatNumber(transcriptStats.toolCallCount)} />
                <MetricCard
                    label="Reasoning"
                    value={formatNumber(transcriptEvents.filter((event) => event.kind === 'reasoning').length)}
                />
                <MetricCard label="Participants" value={formatNumber(getMemberNames(conversation).length)} />
            </div>

            <Tabs className="space-y-3" defaultValue="transcript">
                <TabsList className="grid w-fit min-w-[24rem] grid-cols-3 rounded-full border border-[var(--border)] bg-[var(--panel)] p-1">
                    <TabsTrigger className="rounded-full px-5 text-sm" value="transcript">
                        Transcript
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-5 text-sm" value="metadata">
                        Metadata
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-5 text-sm" value="raw">
                        Raw
                    </TabsTrigger>
                </TabsList>

                <TabsContent className="space-y-3" value="transcript">
                    <TranscriptControls
                        rawJsonDisabled={transcriptEvents.length === 0}
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
                    {transcriptEvents.length > 0 ? (
                        <TranscriptView
                            assistantModel={null}
                            events={transcriptEvents}
                            projectPath={null}
                            showCommentary={transcriptDisplay.showCommentary}
                            showExtraEvents={transcriptDisplay.showExtraEvents}
                            showRawJson={transcriptDisplay.showRawJson}
                            showToolCalls={transcriptDisplay.showToolCalls}
                            showUserMessages={transcriptDisplay.showUserMessages}
                        />
                    ) : (
                        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--muted-foreground)] text-sm">
                            No renderable text messages are available in this Grok Bot replica.
                        </section>
                    )}
                </TabsContent>

                <TabsContent value="metadata">
                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                        <MetadataSection items={buildChatMetadata(conversation)} title="Chat metadata" />
                        <MetadataSection
                            items={buildTranscriptStatsItems(conversation, transcriptEvents, transcriptStats)}
                            title="Transcript stats"
                        />
                    </div>
                </TabsContent>

                <TabsContent value="raw">
                    <GrokBotRawPanels conversation={conversation} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            <ExportDialog
                focusedEvidenceTarget={{ id: conversation.id, source: 'grok-bot' }}
                errorMessage={getMutationErrorMessage(exportMutation.error, 'Chat export failed')}
                open={exportOpen}
                pending={exportMutation.isPending}
                title={`Export ${conversation.title ?? conversation.id}`}
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
                description="Permanently delete this Grok Bot chat from local persistence. This removes its roster entry and transcript replica."
                errorMessage={getMutationErrorMessage(deleteMutation.error, 'Chat delete failed')}
                open={deleteOpen}
                title="Delete this Grok Bot chat?"
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

export const Route = createFileRoute('/grok-bot-chats/$conversationId')({
    component: () => {
        const { conversationId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={conversationId}>
                <GrokBotChatPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Grok Bot chat" />,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(grokBotChatQueryOptions(params.conversationId)),
    pendingComponent: () => (
        <LoadingPanel description="Loading the Grok Bot transcript and metadata." title="Loading chat" />
    ),
    validateSearch: parseThreadTranscriptSearch,
});
