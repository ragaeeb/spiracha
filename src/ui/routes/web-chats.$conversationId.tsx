import type { ThreadEvent } from '@spiracha/lib/codex-browser-types';
import type { WebChatConversationSummary } from '@spiracha/lib/web-chat';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { JsonPanel } from '#/components/json-panel';
import { LoadingPanel } from '#/components/loading-panel';
import { MetadataSection } from '#/components/metadata-section';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { TranscriptControls } from '#/components/transcript-controls';
import { TranscriptView } from '#/components/transcript-view';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import {
    getTranscriptDisplayState,
    parseThreadTranscriptSearch,
    type ThreadTranscriptSearch,
    withThreadTranscriptSearch,
} from '#/lib/route-search';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { getThreadTranscriptStats } from '#/lib/thread-transcript-stats';
import { useClientReady } from '#/lib/use-client-ready';
import { webChatEventsQueryOptions, webChatQueryOptions } from '#/lib/web-chat-queries';

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

const WebChatDetailPage = () => {
    const navigate = useNavigate({ from: Route.fullPath });
    const conversationId = Route.useParams().conversationId;
    const conversation = useSuspenseQuery(webChatQueryOptions(conversationId)).data;
    const clientReady = useClientReady();
    const eventsQuery = useQuery({
        ...webChatEventsQueryOptions(conversationId),
        enabled: clientReady,
    });
    const events = eventsQuery.data ?? [];
    const transcriptSearch = Route.useSearch();
    const transcriptDisplay = getTranscriptDisplayState(transcriptSearch);
    const transcriptMetadata = useMemo(() => buildTranscriptMetadata(events), [events]);
    const updateTranscriptDisplay = (patch: Partial<ThreadTranscriptSearch>) => {
        void navigate({
            replace: true,
            search: (previous: Record<string, unknown>) => withThreadTranscriptSearch(previous, patch),
        });
    };

    return (
        <div className="space-y-4">
            <PageHeader
                breadcrumb={<Breadcrumbs items={[{ label: 'Web', to: '/web' }, { label: conversation.title }]} />}
                eyebrow={`${conversation.platform} web chat`}
                subtitle={`Parsed from ${conversation.fileName}.`}
                title={conversation.title}
            />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(conversation.messageCount)} />
                <MetricCard
                    label="Reasoning"
                    value={
                        eventsQuery.isPending
                            ? 'Loading…'
                            : formatNumber(events.filter((event) => event.kind === 'reasoning').length)
                    }
                />
                <MetricCard label="Platform" value={conversation.platform} />
                <MetricCard label="Model" value={conversation.model ?? 'unknown'} />
            </div>

            <Tabs className="space-y-3" defaultValue="transcript">
                <TabsList className="grid w-fit min-w-[20rem] grid-cols-3 rounded-full border border-[var(--border)] bg-[var(--panel)] p-1">
                    <TabsTrigger className="rounded-full px-5 text-sm" value="transcript">
                        Transcript
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-5 text-sm" value="metadata">
                        Metadata
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-5 text-sm" value="raw">
                        Parsed JSON
                    </TabsTrigger>
                </TabsList>

                <TabsContent className="space-y-3" value="transcript">
                    {eventsQuery.isPending ? (
                        <LoadingPanel description="Loading the parsed web transcript." title="Loading transcript" />
                    ) : eventsQuery.isError ? (
                        <RouteErrorPanel error={eventsQuery.error} title="Failed to load web transcript" />
                    ) : (
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
                        </>
                    )}
                </TabsContent>

                <TabsContent value="metadata">
                    <div className="grid gap-4 xl:grid-cols-2">
                        <MetadataSection
                            items={buildConversationMetadata(conversation)}
                            title="Conversation metadata"
                        />
                        <MetadataSection
                            items={
                                eventsQuery.isPending
                                    ? [{ label: 'Transcript', value: 'Loading…' }]
                                    : eventsQuery.isError
                                      ? [{ label: 'Transcript', value: 'Failed to load.' }]
                                      : transcriptMetadata
                            }
                            title="Transcript stats"
                        />
                    </div>
                </TabsContent>

                <TabsContent value="raw">
                    {eventsQuery.isPending ? (
                        <LoadingPanel description="Loading normalized transcript events." title="Loading parsed JSON" />
                    ) : eventsQuery.isError ? (
                        <RouteErrorPanel error={eventsQuery.error} title="Failed to load parsed JSON" />
                    ) : (
                        <JsonPanel title="Normalized imported conversation" value={{ ...conversation, events }} />
                    )}
                </TabsContent>
            </Tabs>
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
