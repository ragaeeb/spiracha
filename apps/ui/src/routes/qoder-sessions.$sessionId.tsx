import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { QoderSessionTranscript } from '@spiracha/lib/qoder-exporter-types';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { ExportDialog } from '#/components/export-dialog';
import { JsonPanel } from '#/components/json-panel';
import { LoadingPanel } from '#/components/loading-panel';
import { MetadataSection } from '#/components/metadata-section';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { TranscriptControls } from '#/components/transcript-controls';
import { DEFAULT_SHOW_USER_MESSAGES, TranscriptView } from '#/components/transcript-view';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import type { ExportDialogOptions } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { qoderSessionDetailQueryOptions } from '#/lib/qoder-queries';
import { exportQoderSessionFn } from '#/lib/qoder-server';
import { getQoderThreadTranscriptStats, qoderTranscriptToThreadEvents } from '#/lib/qoder-transcript-events';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';

const QoderSessionDetailErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load Qoder session" />;
};

const buildSessionMetadata = (detail: QoderSessionTranscript) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    { label: 'Task ID', value: detail.session.taskId ?? 'unknown' },
    { label: 'Request ID', value: detail.session.requestId ?? 'unknown' },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
                to="/qoder/$workspaceKey"
            >
                {detail.session.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.session.worktree },
    { label: 'Workspace data ID', value: detail.session.workspaceStorageId ?? 'unknown' },
    { label: 'State file', value: detail.session.sourceStatePath ?? 'unknown' },
    { label: 'Status', value: detail.session.status ?? 'unknown' },
    { label: 'Model', value: detail.session.model ?? 'unknown' },
    { label: 'Execution mode', value: detail.session.executionMode ?? 'unknown' },
    { label: 'Agent class', value: detail.session.agentClass ?? 'unknown' },
    {
        label: 'Created',
        value: <span suppressHydrationWarning>{formatDateTime(detail.session.createdAtMs)}</span>,
    },
    {
        label: 'Last active',
        value: <span suppressHydrationWarning>{formatDateTime(detail.session.lastActiveAtMs)}</span>,
    },
];

const buildTranscriptStatsItems = (
    detail: QoderSessionTranscript,
    events: ThreadEvent[],
    stats: ThreadTranscriptStats,
) => [
    { label: 'Event kinds', value: formatList([...new Set(events.map((event) => event.kind))]) },
    { label: 'Messages', value: formatNumber(stats.messageCount) },
    { label: 'User messages', value: formatNumber(stats.userMessageCount) },
    { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
    { label: 'Final answers', value: formatNumber(stats.finalAnswerCount) },
    { label: 'File operations', value: formatNumber(detail.session.fileOperationCount) },
    { label: 'Snapshots', value: formatNumber(detail.session.snapshotFileCount) },
    { label: 'Renderable parts', value: formatNumber(detail.renderablePartCount) },
];

const QoderRawPanels = ({ detail, events }: { detail: QoderSessionTranscript; events: ThreadEvent[] }) => {
    return (
        <div className="space-y-4">
            <JsonPanel title="Session summary" value={detail.session} />
            <JsonPanel title="Qoder entries" value={detail.entries} />
            <JsonPanel title="Raw Qoder session" value={detail.rawSession} />
            <JsonPanel title="Transcript events" value={events} />
        </div>
    );
};

const QoderSessionDetailPage = () => {
    const detail = useSuspenseQuery(qoderSessionDetailQueryOptions(Route.useParams().sessionId)).data;
    const [pendingExport, setPendingExport] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(DEFAULT_SHOW_USER_MESSAGES);
    const transcriptEvents = useMemo(() => qoderTranscriptToThreadEvents(detail), [detail]);
    const transcriptStats = useMemo(() => getQoderThreadTranscriptStats(transcriptEvents), [transcriptEvents]);
    const modelLabel = detail.session.model ?? 'Qoder';

    const exportSessionMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportQoderSessionFn({
                data: {
                    includeCommentary: options.includeCommentary,
                    includeMetadata: options.includeMetadata,
                    includeTools: options.includeTools,
                    outputFormat: options.outputFormat,
                    sessionId: detail.session.sessionId,
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
            setPendingExport(false);
        },
    });

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <Button
                        className="rounded-full"
                        type="button"
                        variant="outline"
                        onClick={() => setPendingExport(true)}
                    >
                        <Download className="mr-2 size-4" />
                        Export
                    </Button>
                }
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'Qoder', to: '/qoder' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
                                to: '/qoder/$workspaceKey',
                            },
                            { label: detail.session.title },
                        ]}
                    />
                }
                eyebrow="Qoder session"
                subtitle="Session detail for the selected Qoder local history entry and local state."
                title={detail.session.title}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Prompts" value={formatNumber(detail.session.messageCount)} />
                <MetricCard label="File ops" value={formatNumber(detail.session.fileOperationCount)} />
                <MetricCard label="Snapshots" value={formatNumber(detail.session.snapshotFileCount)} />
                <MetricCard label="Model" value={modelLabel} />
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
                        showCommentary={showCommentary}
                        showExtraEvents={showExtraEvents}
                        showRawJson={showRawJson}
                        showToolCalls={showToolCalls}
                        showUserMessages={showUserMessages}
                        onShowCommentaryChange={setShowCommentary}
                        onShowExtraEventsChange={setShowExtraEvents}
                        onShowRawJsonChange={setShowRawJson}
                        onShowToolCallsChange={setShowToolCalls}
                        onShowUserMessagesChange={setShowUserMessages}
                    />
                    {transcriptEvents.length > 0 ? (
                        <TranscriptView
                            assistantModel={modelLabel}
                            events={transcriptEvents}
                            projectPath={detail.session.worktree}
                            showCommentary={showCommentary}
                            showExtraEvents={showExtraEvents}
                            showRawJson={showRawJson}
                            showToolCalls={showToolCalls}
                            showUserMessages={showUserMessages}
                        />
                    ) : (
                        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
                            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                                Transcript
                            </h3>
                            <p className="mt-3 text-[var(--muted-foreground)] text-sm">
                                No renderable Qoder transcript content was found for this session.
                            </p>
                        </section>
                    )}
                </TabsContent>

                <TabsContent value="metadata">
                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                        <MetadataSection items={buildSessionMetadata(detail)} title="Session metadata" />
                        <MetadataSection
                            items={buildTranscriptStatsItems(detail, transcriptEvents, transcriptStats)}
                            title="Transcript stats"
                        />
                    </div>
                </TabsContent>

                <TabsContent value="raw">
                    <QoderRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            <ExportDialog
                focusedEvidenceTarget={{ id: detail.session.sessionId, source: 'qoder' }}
                errorMessage={
                    exportSessionMutation.isError
                        ? exportSessionMutation.error instanceof Error
                            ? exportSessionMutation.error.message
                            : 'Export failed'
                        : null
                }
                open={pendingExport}
                pending={exportSessionMutation.isPending}
                title={`Export ${detail.session.title}`}
                onExport={(options) => exportSessionMutation.mutate(options)}
                onOpenChange={(open) => {
                    setPendingExport(open);
                    if (!open) {
                        exportSessionMutation.reset();
                    }
                }}
            />
        </div>
    );
};

export const Route = createFileRoute('/qoder-sessions/$sessionId')({
    component: () => {
        const { sessionId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={sessionId}>
                <QoderSessionDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: QoderSessionDetailErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(qoderSessionDetailQueryOptions(params.sessionId)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the Qoder transcript, file operations, and session metadata."
            title="Loading session"
        />
    ),
});
