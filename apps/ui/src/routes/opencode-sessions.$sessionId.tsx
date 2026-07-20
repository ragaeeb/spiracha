import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { OpenCodeSessionTranscript } from '@spiracha/lib/opencode-exporter-types';
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
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import type { ExportDialogOptions } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber, formatTokens } from '#/lib/formatters';
import { openCodeSessionDetailQueryOptions, openCodeWorkspacesQueryOptions } from '#/lib/opencode-queries';
import { deleteOpenCodeSessionFn, exportOpenCodeSessionFn } from '#/lib/opencode-server';
import { getOpenCodeThreadTranscriptStats, openCodeTranscriptToThreadEvents } from '#/lib/opencode-transcript-events';
import {
    getTranscriptDisplayState,
    parseThreadTranscriptSearch,
    type ThreadTranscriptSearch,
    withThreadTranscriptSearch,
} from '#/lib/route-search';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { shouldNavigateToSourceIndexAfterDelete } from '#/lib/workspace-delete-navigation';

const OpenCodeSessionDetailErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load OpenCode session" />;
};

const buildSessionMetadata = (detail: OpenCodeSessionTranscript) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
                to="/opencode/$workspaceKey"
            >
                {detail.session.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.session.worktree },
    { label: 'Directory', value: detail.session.directory },
    { label: 'Slug', value: detail.session.slug },
    { label: 'Agent', value: detail.session.agent ?? 'unknown' },
    { label: 'Model', value: detail.session.modelLabel ?? 'unknown' },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(detail.session.createdAtMs)}</span> },
    { label: 'Updated', value: <span suppressHydrationWarning>{formatDateTime(detail.session.lastUpdatedAtMs)}</span> },
    { label: 'Archived', value: <span suppressHydrationWarning>{formatDateTime(detail.session.archivedAtMs)}</span> },
];

const buildTranscriptStatsItems = (
    detail: OpenCodeSessionTranscript,
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

const OpenCodeRawPanels = ({ detail, events }: { detail: OpenCodeSessionTranscript; events: ThreadEvent[] }) => {
    return (
        <div className="space-y-4">
            <JsonPanel title="Session summary" value={detail.session} />
            <JsonPanel title="OpenCode messages" value={detail.messages} />
            <JsonPanel title="Transcript events" value={events} />
        </div>
    );
};

const OpenCodeSessionDetailPage = () => {
    const navigate = useNavigate({ from: Route.fullPath });
    const transcriptDisplay = getTranscriptDisplayState(Route.useSearch());
    const queryClient = useQueryClient();
    const params = Route.useParams();
    const detail = useSuspenseQuery(openCodeSessionDetailQueryOptions(params.sessionId)).data;
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
    const transcriptEvents = useMemo(() => (detail ? openCodeTranscriptToThreadEvents(detail) : []), [detail]);
    const transcriptStats = useMemo(() => getOpenCodeThreadTranscriptStats(transcriptEvents), [transcriptEvents]);

    const exportSessionMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            if (!detail) {
                throw new Error(`OpenCode session not found: ${params.sessionId}`);
            }

            const download = await exportOpenCodeSessionFn({
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
        mutationFn: () => {
            if (!detail) {
                throw new Error(`OpenCode session not found: ${params.sessionId}`);
            }

            return deleteOpenCodeSessionFn({ data: { sessionId: detail.session.sessionId } });
        },
        onSuccess: async () => {
            if (!detail) {
                return;
            }

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['opencode-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['opencode-sessions', detail.session.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['opencode-session', detail.session.sessionId] }),
            ]);
            const workspaces = await queryClient.fetchQuery(openCodeWorkspacesQueryOptions());
            if (
                shouldNavigateToSourceIndexAfterDelete(
                    workspaces,
                    detail.session.workspaceKey,
                    (workspace) => workspace.key,
                )
            ) {
                navigate({ to: '/opencode' });
                return;
            }
            navigate({
                params: { workspaceKey: detail.session.workspaceKey },
                to: '/opencode/$workspaceKey',
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
                            { label: 'OpenCode', to: '/opencode' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
                                to: '/opencode/$workspaceKey',
                            },
                            { label: detail.session.title },
                        ]}
                    />
                }
                eyebrow="OpenCode session"
                subtitle="Session detail for the selected OpenCode project conversation."
                title={detail.session.title}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.session.messageCount)} />
                <MetricCard label="Parts" value={formatNumber(detail.partCount)} />
                <MetricCard label="Tool calls" value={formatNumber(detail.session.toolPartCount)} />
                <MetricCard label="Tokens" value={formatTokens(detail.session.totalTokens)} />
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
                        />
                    ) : (
                        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                                Transcript
                            </h3>
                            <p className="mt-4 text-[var(--muted-foreground)] text-sm">
                                No renderable OpenCode transcript content was found for this session.
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
                    <OpenCodeRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            <ExportDialog
                focusedEvidenceTarget={{ id: detail.session.sessionId, source: 'opencode' }}
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
                description="Permanently delete this OpenCode session from the database. This removes the session, child sessions, messages, and parts."
                errorMessage={
                    deleteSessionMutation.isError
                        ? deleteSessionMutation.error instanceof Error
                            ? deleteSessionMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={deleteOpen}
                title="Delete this OpenCode session?"
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

export const Route = createFileRoute('/opencode-sessions/$sessionId')({
    component: () => {
        const { sessionId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={sessionId}>
                <OpenCodeSessionDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: OpenCodeSessionDetailErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(openCodeSessionDetailQueryOptions(params.sessionId)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the OpenCode transcript, parts, and session metadata."
            title="Loading session"
        />
    ),
    validateSearch: parseThreadTranscriptSearch,
});
