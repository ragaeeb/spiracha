import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { FxSessionTranscript } from '@spiracha/lib/fx-exporter-types';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
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
import { DEFAULT_SHOW_USER_MESSAGES, TranscriptView } from '#/components/transcript-view';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import type { ExportDialogOptions } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { fxSessionDetailQueryOptions, fxWorkspacesQueryOptions } from '#/lib/fx-queries';
import { deleteFxSessionFn, exportFxSessionFn } from '#/lib/fx-server';
import { fxTranscriptToThreadEvents, getFxThreadTranscriptStats } from '#/lib/fx-transcript-events';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { shouldNavigateToSourceIndexAfterDelete } from '#/lib/workspace-delete-navigation';

const buildSessionMetadata = (detail: FxSessionTranscript) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
                to="/fx/$workspaceKey"
            >
                {detail.session.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.session.worktree },
    { label: 'Session directory', value: detail.session.sessionDir },
    { label: 'Model', value: detail.session.currentModelId ?? 'unknown' },
    { label: 'Effort', value: detail.session.currentModelVariant ?? 'unknown' },
    { label: 'Status', value: detail.session.status ?? 'unknown' },
    { label: 'Language', value: detail.session.conversationLanguage ?? 'unknown' },
    { label: 'Input tokens', value: formatNumber(detail.session.totalInputTokens ?? 0) },
    { label: 'Output tokens', value: formatNumber(detail.session.totalOutputTokens ?? 0) },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(detail.session.createdAtMs)}</span> },
    { label: 'Updated', value: <span suppressHydrationWarning>{formatDateTime(detail.session.lastActiveAtMs)}</span> },
];

const buildTranscriptStatsItems = (
    detail: FxSessionTranscript,
    events: ThreadEvent[],
    stats: ThreadTranscriptStats,
) => [
    { label: 'Event kinds', value: formatList([...new Set(events.map((event) => event.kind))]) },
    { label: 'Messages', value: formatNumber(stats.messageCount) },
    { label: 'User messages', value: formatNumber(stats.userMessageCount) },
    { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
    { label: 'Final answers', value: formatNumber(stats.finalAnswerCount) },
    { label: 'Tool calls', value: formatNumber(stats.toolCallCount) },
    { label: 'Tool outputs', value: formatNumber(stats.toolOutputCount) },
    { label: 'Renderable parts', value: formatNumber(detail.renderablePartCount) },
];

const FxSessionDetailPage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const detail = useSuspenseQuery(fxSessionDetailQueryOptions(Route.useParams().sessionId)).data;
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [pendingExport, setPendingExport] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(DEFAULT_SHOW_USER_MESSAGES);
    const transcriptEvents = useMemo(() => fxTranscriptToThreadEvents(detail), [detail]);
    const transcriptStats = useMemo(() => getFxThreadTranscriptStats(transcriptEvents), [transcriptEvents]);

    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportFxSessionFn({
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
            await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl);
        },
        onSuccess: () => setPendingExport(false),
    });
    const deleteMutation = useMutation({
        mutationFn: () => deleteFxSessionFn({ data: { sessionId: detail.session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['fx-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['fx-sessions', detail.session.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['fx-session', detail.session.sessionId] }),
            ]);
            const workspaces = await queryClient.fetchQuery(fxWorkspacesQueryOptions());
            if (shouldNavigateToSourceIndexAfterDelete(workspaces, detail.session.workspaceKey, (item) => item.key)) {
                await navigate({ to: '/fx' });
                return;
            }
            await navigate({ params: { workspaceKey: detail.session.workspaceKey }, to: '/fx/$workspaceKey' });
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
                            onClick={() => setPendingExport(true)}
                        >
                            <Download className="mr-2 size-4" /> Export
                        </Button>
                        <Button
                            className="rounded-full border-[var(--destructive)]/20 text-[var(--destructive)]"
                            type="button"
                            variant="outline"
                            onClick={() => setDeleteOpen(true)}
                        >
                            <Trash2 className="mr-2 size-4" /> Delete
                        </Button>
                    </>
                }
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'FX', to: '/fx' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
                                to: '/fx/$workspaceKey',
                            },
                            { label: detail.session.title },
                        ]}
                    />
                }
                eyebrow="FX session"
                subtitle="Session detail reconstructed from the FX checkpoint and append-only event log."
                title={detail.session.title}
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.session.messageCount)} />
                <MetricCard label="Tool calls" value={formatNumber(detail.session.toolCallCount)} />
                <MetricCard label="Tool outputs" value={formatNumber(detail.session.toolResultCount)} />
                <MetricCard label="Renderable parts" value={formatNumber(detail.renderablePartCount)} />
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
                        rawJsonDisabled={Boolean(detail.rawPayloadsOmitted) || transcriptEvents.length === 0}
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
                            assistantModel={detail.session.currentModelId}
                            events={transcriptEvents}
                            projectPath={detail.session.worktree}
                            showCommentary={showCommentary}
                            showExtraEvents={showExtraEvents}
                            showRawJson={showRawJson && !detail.rawPayloadsOmitted}
                            showToolCalls={showToolCalls}
                            showUserMessages={showUserMessages}
                        />
                    ) : (
                        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
                            <p className="text-[var(--muted-foreground)] text-sm">
                                No renderable FX transcript content was found for this session.
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
                <TabsContent className="space-y-4" value="raw">
                    <JsonPanel title="Session summary" value={detail.session} />
                    <JsonPanel title="FX transcript messages" value={detail.messages} />
                    <JsonPanel title="Transcript events" value={transcriptEvents} />
                </TabsContent>
            </Tabs>
            <ExportDialog
                focusedEvidenceTarget={{ id: detail.session.sessionId, source: 'fx' }}
                errorMessage={exportMutation.isError ? (exportMutation.error as Error).message : null}
                open={pendingExport}
                pending={exportMutation.isPending}
                title={`Export ${detail.session.title}`}
                onExport={(options) => exportMutation.mutate(options)}
                onOpenChange={(open) => {
                    setPendingExport(open);
                    if (!open) {
                        exportMutation.reset();
                    }
                }}
            />
            <DeleteConfirmDialog
                confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete session'}
                description={`Permanently delete "${detail.session.title}". This removes its session directory and FX index/latest-pointer entries. Workspace files and global FX history are preserved.`}
                errorMessage={deleteMutation.isError ? (deleteMutation.error as Error).message : null}
                open={deleteOpen}
                title="Delete this FX session?"
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

export const Route = createFileRoute('/fx-sessions/$sessionId')({
    component: () => {
        const { sessionId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={sessionId}>
                <FxSessionDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load FX session" />,
    loader: ({ context, params }) => context.queryClient.ensureQueryData(fxSessionDetailQueryOptions(params.sessionId)),
    pendingComponent: () => (
        <LoadingPanel description="Loading the FX transcript and session metadata." title="Loading session" />
    ),
});
