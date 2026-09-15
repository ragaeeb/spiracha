import type { CommandCodeSessionTranscript } from '@spiracha/lib/command-code-exporter-types';
import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/conversation-data/conversation-events';
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
import { TranscriptView } from '#/components/transcript-view';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { commandCodeSessionDetailQueryOptions, commandCodeWorkspacesQueryOptions } from '#/lib/command-code-queries';
import { deleteCommandCodeSessionFn, exportCommandCodeSessionFn } from '#/lib/command-code-server';
import {
    commandCodeMessagesToThreadEvents,
    getCommandCodeThreadTranscriptStats,
} from '#/lib/command-code-transcript-events';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import type { ExportDialogOptions } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import {
    getTranscriptDisplayState,
    parseThreadTranscriptSearch,
    type ThreadTranscriptSearch,
    withThreadTranscriptSearch,
} from '#/lib/route-search';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { shouldNavigateToSourceIndexAfterDelete } from '#/lib/workspace-delete-navigation';

const buildSessionMetadata = (detail: CommandCodeSessionTranscript) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
                to="/command-code/$workspaceKey"
            >
                {detail.session.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.session.worktree },
    { label: 'Model', value: detail.session.modelLabel ?? 'unknown' },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(detail.session.createdAtMs)}</span> },
    {
        label: 'Last active',
        value: <span suppressHydrationWarning>{formatDateTime(detail.session.lastActiveAtMs)}</span>,
    },
    { label: 'Source file', value: detail.session.filePath },
    { label: 'Records', value: formatNumber(detail.session.recordCount) },
];

const buildTranscriptStatsItems = (
    detail: CommandCodeSessionTranscript,
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
    { label: 'Renderable messages', value: formatNumber(detail.session.renderableMessageCount) },
];

const CommandCodeRawPanels = ({ detail, events }: { detail: CommandCodeSessionTranscript; events: ThreadEvent[] }) => (
    <div className="space-y-4">
        <JsonPanel title="Session summary" value={detail.session} />
        <JsonPanel title="Raw JSONL records" value={detail.rawRecords} />
        <JsonPanel title="Normalized messages" value={detail.messages} />
        <JsonPanel title="Transcript events" value={events} />
    </div>
);

const CommandCodeSessionDetailPage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const params = Route.useParams();
    const transcriptSearch = Route.useSearch();
    const transcriptDisplay = getTranscriptDisplayState(transcriptSearch);
    const queryClient = useQueryClient();
    const detail = useSuspenseQuery(commandCodeSessionDetailQueryOptions(params.sessionId)).data;
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [pendingExport, setPendingExport] = useState(false);
    const { showCommentary, showExtraEvents, showRawJson, showToolCalls, showUserMessages } = transcriptDisplay;
    const updateTranscriptDisplay = (patch: Partial<ThreadTranscriptSearch>) => {
        void navigate({
            params: true,
            replace: true,
            search: (previous: Record<string, unknown>) => withThreadTranscriptSearch(previous, patch),
        });
    };
    const transcriptEvents = useMemo(() => commandCodeMessagesToThreadEvents(detail.messages), [detail.messages]);
    const transcriptStats = useMemo(() => getCommandCodeThreadTranscriptStats(transcriptEvents), [transcriptEvents]);
    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportCommandCodeSessionFn({
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
        mutationFn: () => deleteCommandCodeSessionFn({ data: { sessionId: detail.session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['command-code-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['command-code-sessions', detail.session.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['command-code-session', detail.session.sessionId] }),
            ]);
            const workspaces = await queryClient.fetchQuery(commandCodeWorkspacesQueryOptions());
            if (
                shouldNavigateToSourceIndexAfterDelete(
                    workspaces,
                    detail.session.workspaceKey,
                    (workspace) => workspace.key,
                )
            ) {
                await navigate({ to: '/command-code' });
                return;
            }
            await navigate({
                params: { workspaceKey: detail.session.workspaceKey },
                to: '/command-code/$workspaceKey',
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
                            { label: 'Command Code', to: '/command-code' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
                                to: '/command-code/$workspaceKey',
                            },
                            { label: detail.session.title },
                        ]}
                    />
                }
                eyebrow="Command Code session"
                subtitle="Session detail for the selected local Command Code conversation."
                title={detail.session.title}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.session.messageCount)} />
                <MetricCard label="Tool calls" value={formatNumber(detail.session.toolCallCount)} />
                <MetricCard label="Tool outputs" value={formatNumber(detail.session.toolOutputCount)} />
                <MetricCard label="Records" value={formatNumber(detail.session.recordCount)} />
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
                        onShowCommentaryChange={(value) => updateTranscriptDisplay({ commentary: value })}
                        onShowExtraEventsChange={(value) => updateTranscriptDisplay({ extra: value })}
                        onShowRawJsonChange={(value) => updateTranscriptDisplay({ raw: value })}
                        onShowToolCallsChange={(value) => updateTranscriptDisplay({ tools: value })}
                        onShowUserMessagesChange={(value) => updateTranscriptDisplay({ user: value })}
                    />
                    {transcriptEvents.length > 0 ? (
                        <TranscriptView
                            assistantModel={detail.session.modelLabel}
                            events={transcriptEvents}
                            projectPath={detail.session.worktree}
                            showCommentary={showCommentary}
                            showExtraEvents={showExtraEvents}
                            showRawJson={showRawJson}
                            showToolCalls={showToolCalls}
                            showUserMessages={showUserMessages}
                            sortOrder={transcriptSearch.sort ?? 'earliest'}
                            onSortOrderChange={(value) => updateTranscriptDisplay({ sort: value })}
                        />
                    ) : (
                        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
                            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                                Transcript
                            </h3>
                            <p className="mt-3 text-[var(--muted-foreground)] text-sm">
                                No renderable Command Code transcript content was found for this session.
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
                    <CommandCodeRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            <ExportDialog
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
                description={`Permanently delete "${detail.session.title}" from Command Code history. This removes its session JSONL file and matching metadata/checkpoint sidecars.`}
                errorMessage={
                    deleteMutation.isError
                        ? deleteMutation.error instanceof Error
                            ? deleteMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={deleteOpen}
                title="Delete this Command Code session?"
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

export const Route = createFileRoute('/command-code-sessions/$sessionId')({
    component: () => {
        const { sessionId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={sessionId}>
                <CommandCodeSessionDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Command Code session" />,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(commandCodeSessionDetailQueryOptions(params.sessionId)),
    pendingComponent: () => (
        <LoadingPanel description="Loading the Command Code transcript and session metadata." title="Loading session" />
    ),
    validateSearch: parseThreadTranscriptSearch,
});
