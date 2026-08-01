import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { MiniMaxCodeSessionTranscript } from '@spiracha/lib/minimax-code-exporter-types';
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
import { miniMaxCodeSessionDetailQueryOptions, miniMaxCodeWorkspacesQueryOptions } from '#/lib/minimax-code-queries';
import { deleteMiniMaxCodeSessionFn, exportMiniMaxCodeSessionFn } from '#/lib/minimax-code-server';
import {
    getMiniMaxCodeThreadTranscriptStats,
    miniMaxCodeTranscriptToThreadEvents,
} from '#/lib/minimax-code-transcript-events';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { shouldNavigateToSourceIndexAfterDelete } from '#/lib/workspace-delete-navigation';

const MiniMaxCodeSessionDetailErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load MiniMax Code session" />;
};

const buildSessionMetadata = (detail: MiniMaxCodeSessionTranscript) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
                to="/minimax-code/$workspaceKey"
            >
                {detail.session.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.session.worktree },
    { label: 'Snapshot', value: detail.session.snapshotPath },
    { label: 'Agent', value: detail.session.agentName ?? 'unknown' },
    { label: 'Model', value: detail.session.currentModelId ?? 'unknown' },
    { label: 'Model variant', value: detail.session.currentModelVariant ?? 'unknown' },
    { label: 'Runtime', value: detail.session.runtime ?? 'unknown' },
    { label: 'Status', value: detail.session.status ?? 'unknown' },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(detail.session.createdAtMs)}</span> },
    { label: 'Updated', value: <span suppressHydrationWarning>{formatDateTime(detail.session.lastActiveAtMs)}</span> },
];

const buildTranscriptStatsItems = (
    detail: MiniMaxCodeSessionTranscript,
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

const MiniMaxCodeSessionDetailPage = () => {
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const detail = useSuspenseQuery(miniMaxCodeSessionDetailQueryOptions(Route.useParams().sessionId)).data;
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [pendingExport, setPendingExport] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(DEFAULT_SHOW_USER_MESSAGES);
    const transcriptEvents = useMemo(() => miniMaxCodeTranscriptToThreadEvents(detail), [detail]);
    const transcriptStats = useMemo(() => getMiniMaxCodeThreadTranscriptStats(transcriptEvents), [transcriptEvents]);
    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportMiniMaxCodeSessionFn({
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
        onSuccess: () => setPendingExport(false),
    });
    const deleteMutation = useMutation({
        mutationFn: () => deleteMiniMaxCodeSessionFn({ data: { sessionId: detail.session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['minimax-code-workspaces'] }),
                queryClient.invalidateQueries({
                    queryKey: ['minimax-code-sessions', detail.session.workspaceKey],
                }),
                queryClient.invalidateQueries({ queryKey: ['minimax-code-session', detail.session.sessionId] }),
            ]);
            const workspaces = await queryClient.fetchQuery(miniMaxCodeWorkspacesQueryOptions());
            if (
                shouldNavigateToSourceIndexAfterDelete(
                    workspaces,
                    detail.session.workspaceKey,
                    (workspace) => workspace.key,
                )
            ) {
                await navigate({ to: '/minimax-code' });
                return;
            }
            await navigate({
                params: { workspaceKey: detail.session.workspaceKey },
                to: '/minimax-code/$workspaceKey',
            });
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
                            { label: 'MiniMax Code', to: '/minimax-code' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
                                to: '/minimax-code/$workspaceKey',
                            },
                            { label: detail.session.title },
                        ]}
                    />
                }
                eyebrow="MiniMax Code session"
                subtitle="Session detail from the finalized local MiniMax Code v2 snapshot."
                title={detail.session.title}
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.session.messageCount)} />
                <MetricCard label="Tool calls" value={formatNumber(detail.session.toolCallCount)} />
                <MetricCard label="Reasoning" value={formatNumber(detail.session.reasoningCount)} />
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
                                No renderable MiniMax Code transcript content was found for this session.
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
                    <JsonPanel title="MiniMax Code display messages" value={detail.messages} />
                    <JsonPanel title="Transcript events" value={transcriptEvents} />
                </TabsContent>
            </Tabs>
            <ExportDialog
                focusedEvidenceTarget={{ id: detail.session.sessionId, source: 'minimax-code' }}
                errorMessage={
                    exportMutation.isError
                        ? exportMutation.error instanceof Error
                            ? exportMutation.error.message
                            : 'Export failed'
                        : null
                }
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
                description={`Permanently delete "${detail.session.title}". This removes its finalized session directory and runtime database rows. Generated workspace files and observability logs are preserved.`}
                errorMessage={
                    deleteMutation.isError
                        ? deleteMutation.error instanceof Error
                            ? deleteMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={deleteOpen}
                title="Delete this MiniMax Code session?"
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

export const Route = createFileRoute('/minimax-code-sessions/$sessionId')({
    component: () => {
        const { sessionId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={sessionId}>
                <MiniMaxCodeSessionDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: MiniMaxCodeSessionDetailErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(miniMaxCodeSessionDetailQueryOptions(params.sessionId)),
    pendingComponent: () => (
        <LoadingPanel description="Loading the MiniMax Code transcript and session metadata." title="Loading session" />
    ),
});
