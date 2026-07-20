import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { GrokSessionTranscript } from '@spiracha/lib/grok-exporter-types';
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
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import type { ExportDialogOptions } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { grokSessionDetailQueryOptions, grokWorkspacesQueryOptions } from '#/lib/grok-queries';
import { deleteGrokSessionFn, exportGrokSessionFn } from '#/lib/grok-server';
import { getGrokThreadTranscriptStats, grokTranscriptToThreadEvents } from '#/lib/grok-transcript-events';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { shouldNavigateToSourceIndexAfterDelete } from '#/lib/workspace-delete-navigation';

const GrokSessionDetailErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load Grok session" />;
};

const buildSessionMetadata = (detail: GrokSessionTranscript) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
                to="/grok/$workspaceKey"
            >
                {detail.session.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.session.worktree },
    { label: 'Session directory', value: detail.session.sessionDir },
    { label: 'Agent', value: detail.session.agentName ?? 'unknown' },
    { label: 'Model', value: detail.session.modelLabel ?? detail.session.currentModelId ?? 'unknown' },
    { label: 'Git branch', value: detail.session.gitBranch ?? 'unknown' },
    { label: 'Head commit', value: detail.session.headCommit ?? 'unknown' },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(detail.session.createdAtMs)}</span> },
    { label: 'Updated', value: <span suppressHydrationWarning>{formatDateTime(detail.session.lastActiveAtMs)}</span> },
];

const buildTranscriptStatsItems = (
    detail: GrokSessionTranscript,
    events: ThreadEvent[],
    stats: ThreadTranscriptStats,
) => [
    { label: 'Event kinds', value: formatList([...new Set(events.map((event) => event.kind))]) },
    { label: 'Messages', value: formatNumber(stats.messageCount) },
    { label: 'User messages', value: formatNumber(stats.userMessageCount) },
    { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
    { label: 'Reasoning events', value: formatNumber(events.filter((event) => event.kind === 'reasoning').length) },
    { label: 'Final answers', value: formatNumber(stats.finalAnswerCount) },
    { label: 'Tool calls', value: formatNumber(stats.toolCallCount) },
    { label: 'Tool outputs', value: formatNumber(stats.toolOutputCount) },
    { label: 'Renderable parts', value: formatNumber(detail.renderablePartCount) },
];

const GrokRawPanels = ({ detail, events }: { detail: GrokSessionTranscript; events: ThreadEvent[] }) => {
    return (
        <div className="space-y-4">
            <JsonPanel title="Session summary" value={detail.session} />
            <JsonPanel title="Grok transcript entries" value={detail.entries} />
            <JsonPanel title="Transcript events" value={events} />
        </div>
    );
};

const GrokSessionDetailPage = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const detail = useSuspenseQuery(grokSessionDetailQueryOptions(Route.useParams().sessionId)).data;
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [pendingExport, setPendingExport] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(DEFAULT_SHOW_USER_MESSAGES);
    const transcriptEvents = useMemo(() => grokTranscriptToThreadEvents(detail), [detail]);
    const transcriptStats = useMemo(() => getGrokThreadTranscriptStats(transcriptEvents), [transcriptEvents]);

    const exportSessionMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportGrokSessionFn({
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

    const deleteSessionMutation = useMutation({
        mutationFn: () => deleteGrokSessionFn({ data: { sessionId: detail.session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['grok-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['grok-sessions', detail.session.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['grok-session', detail.session.sessionId] }),
            ]);
            const workspaces = await queryClient.fetchQuery(grokWorkspacesQueryOptions());
            if (
                shouldNavigateToSourceIndexAfterDelete(
                    workspaces,
                    detail.session.workspaceKey,
                    (workspace) => workspace.key,
                )
            ) {
                navigate({ to: '/grok' });
                return;
            }
            navigate({
                params: { workspaceKey: detail.session.workspaceKey },
                to: '/grok/$workspaceKey',
            });
        },
    });

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <>
                        <Button
                            className="rounded-full"
                            type="button"
                            variant="outline"
                            onClick={() => setPendingExport(true)}
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
                            { label: 'Grok', to: '/grok' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
                                to: '/grok/$workspaceKey',
                            },
                            { label: detail.session.title },
                        ]}
                    />
                }
                eyebrow="Grok session"
                subtitle="Session detail for the selected local Grok CLI conversation."
                title={detail.session.title}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.session.messageCount)} />
                <MetricCard label="Tool calls" value={formatNumber(detail.session.toolCallCount)} />
                <MetricCard label="Reasoning" value={formatNumber(detail.session.reasoningCount)} />
                <MetricCard label="Renderable parts" value={formatNumber(detail.renderablePartCount)} />
            </div>

            <Tabs className="space-y-4" defaultValue="transcript">
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
                            assistantModel={detail.session.modelLabel ?? detail.session.currentModelId}
                            events={transcriptEvents}
                            projectPath={detail.session.worktree}
                            showCommentary={showCommentary}
                            showExtraEvents={showExtraEvents}
                            showRawJson={showRawJson && !detail.rawPayloadsOmitted}
                            showToolCalls={showToolCalls}
                            showUserMessages={showUserMessages}
                        />
                    ) : (
                        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                                Transcript
                            </h3>
                            <p className="mt-4 text-[var(--muted-foreground)] text-sm">
                                No renderable Grok transcript content was found for this session.
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
                    {detail.rawPayloadsOmitted ? (
                        <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--muted-foreground)] text-sm">
                            Raw Grok payloads are omitted from the default session view to keep large transcripts
                            reloadable.
                        </section>
                    ) : null}
                    <GrokRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            <ExportDialog
                focusedEvidenceTarget={{ id: detail.session.sessionId, source: 'grok' }}
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

            <DeleteConfirmDialog
                confirmLabel={deleteSessionMutation.isPending ? 'Deleting...' : 'Delete session'}
                description="Permanently delete this Grok session from local history. This removes the session directory and transcript files."
                errorMessage={
                    deleteSessionMutation.isError
                        ? deleteSessionMutation.error instanceof Error
                            ? deleteSessionMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={deleteOpen}
                title="Delete this Grok session?"
                onConfirm={() => deleteSessionMutation.mutate()}
                onOpenChange={(open) => {
                    setDeleteOpen(open);
                    if (!open) {
                        deleteSessionMutation.reset();
                    }
                }}
            />
        </div>
    );
};

export const Route = createFileRoute('/grok-sessions/$sessionId')({
    component: () => {
        const { sessionId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={sessionId}>
                <GrokSessionDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: GrokSessionDetailErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(grokSessionDetailQueryOptions(params.sessionId)),
    pendingComponent: () => (
        <LoadingPanel description="Loading the Grok transcript and session metadata." title="Loading session" />
    ),
});
