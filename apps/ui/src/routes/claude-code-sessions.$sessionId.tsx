import type { ClaudeCodeSessionTranscript } from '@spiracha/lib/claude-code-exporter-types';
import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
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
import {
    claudeCodeSessionDetailQueryOptions,
    claudeCodeSessionTranscriptQueryOptions,
    claudeCodeWorkspacesQueryOptions,
} from '#/lib/claude-code-queries';
import { deleteClaudeCodeSessionFn, exportClaudeCodeSessionFn } from '#/lib/claude-code-server';
import {
    claudeCodeTranscriptToThreadEvents,
    getClaudeCodeThreadTranscriptStats,
} from '#/lib/claude-code-transcript-events';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import type { ExportDialogOptions } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber, formatTokens } from '#/lib/formatters';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import {
    getTranscriptDisplayState,
    parseThreadTranscriptSearch,
    type ThreadTranscriptSearch,
    withThreadTranscriptSearch,
} from '#/lib/route-search';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { shouldNavigateToSourceIndexAfterDelete } from '#/lib/workspace-delete-navigation';

export const Route = createFileRoute('/claude-code-sessions/$sessionId')({
    component: () => {
        const { sessionId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={sessionId}>
                <ClaudeCodeSessionDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: ClaudeCodeSessionDetailErrorComponent,
    loader: ({ context, deps, params }) => {
        const { merged } = deps as { merged: boolean };
        return context.queryClient.ensureQueryData(claudeCodeSessionDetailQueryOptions(params.sessionId, merged));
    },
    loaderDeps: ({ search }) => ({ merged: search.merged === true }),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the Claude Code transcript, messages, tool calls, and session metadata."
            title="Loading session"
        />
    ),
    validateSearch: parseThreadTranscriptSearch,
});

function ClaudeCodeSessionDetailErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Claude Code session" />;
}

const buildSessionMetadata = (detail: ClaudeCodeSessionTranscript, merged: boolean) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
                search={merged ? { merged: true } : undefined}
                to="/claude-code/$workspaceKey"
            >
                {detail.session.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.session.worktree },
    { label: 'CWD', value: detail.session.cwd },
    { label: 'Model', value: detail.session.model ?? 'unknown' },
    { label: 'Version', value: detail.session.version ?? 'unknown' },
    { label: 'Git branch', value: detail.session.gitBranch ?? 'unknown' },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(detail.session.createdAtMs)}</span> },
    {
        label: 'Last active',
        value: <span suppressHydrationWarning>{formatDateTime(detail.session.lastActiveAtMs)}</span>,
    },
    { label: 'Source file', value: detail.session.filePath },
];

const buildTranscriptStatsItems = (
    detail: ClaudeCodeSessionTranscript,
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
    { label: 'Attachments', value: formatNumber(detail.session.attachmentCount) },
    { label: 'Renderable parts', value: formatNumber(detail.renderablePartCount) },
];

function ClaudeCodeRawPanels({ detail, events }: { detail: ClaudeCodeSessionTranscript; events: ThreadEvent[] }) {
    if (detail.rawPayloadsOmitted) {
        return (
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
                <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                    Raw payloads omitted
                </h3>
                <p className="mt-3 text-[var(--muted-foreground)] text-sm">
                    This Claude Code session is large, so raw JSON payload copies were omitted from the browser detail
                    response. Export still reads the full source session from disk.
                </p>
            </section>
        );
    }

    return (
        <div className="space-y-4">
            <JsonPanel title="Session summary" value={detail.session} />
            <JsonPanel title="Claude Code entries" value={detail.entries} />
            <JsonPanel title="Raw JSONL events" value={detail.rawEvents} />
            <JsonPanel title="Transcript events" value={events} />
        </div>
    );
}

const ClaudeCodeTranscriptPreviewNotice = ({
    fullTranscriptLoaded,
    omittedEntryCount,
    pending,
    onLoad,
}: {
    fullTranscriptLoaded: boolean;
    omittedEntryCount: number;
    pending: boolean;
    onLoad: () => void;
}) => {
    const buttonLabel = fullTranscriptLoaded
        ? 'Full transcript loaded'
        : pending
          ? 'Loading full transcript...'
          : 'Load Full Transcript';

    return (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-base">Showing a compact transcript preview</h3>
            <p className="mt-1.5 text-[var(--muted-foreground)] text-sm leading-6">
                Spiracha omitted {formatNumber(omittedEntryCount)} internal transcript entries from the initial page
                load. The preview keeps the beginning and latest activity.
            </p>
            <div className="mt-3">
                <Button disabled={pending || fullTranscriptLoaded} variant="outline" onClick={onLoad}>
                    {buttonLabel}
                </Button>
            </div>
        </section>
    );
};

function ClaudeCodeSessionDetailPage() {
    const navigate = useNavigate({ from: Route.fullPath });
    const transcriptSearch = Route.useSearch();
    const transcriptDisplay = getTranscriptDisplayState(transcriptSearch);
    const merged = transcriptSearch.merged === true;
    const queryClient = useQueryClient();
    const params = Route.useParams();
    const initialDetail = useSuspenseQuery(claudeCodeSessionDetailQueryOptions(params.sessionId, merged)).data;
    const [shouldLoadFullTranscript, setShouldLoadFullTranscript] = useState(false);
    const fullTranscriptQuery = useQuery({
        ...claudeCodeSessionTranscriptQueryOptions(params.sessionId, merged),
        enabled: shouldLoadFullTranscript,
    });
    const detail = fullTranscriptQuery.data ?? initialDetail;
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
    const transcriptEvents = useMemo(() => claudeCodeTranscriptToThreadEvents(detail), [detail]);
    const transcriptStats = useMemo(() => getClaudeCodeThreadTranscriptStats(transcriptEvents), [transcriptEvents]);

    const exportSessionMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportClaudeCodeSessionFn({
                data: {
                    includeCommentary: options.includeCommentary,
                    includeMetadata: options.includeMetadata,
                    includeTools: options.includeTools,
                    merged,
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
        mutationFn: () => deleteClaudeCodeSessionFn({ data: { merged, sessionId: detail.session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['claude-code-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['claude-code-sessions', detail.session.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['claude-code-session', detail.session.sessionId] }),
                queryClient.invalidateQueries({ queryKey: ['claude-code-session', params.sessionId] }),
                queryClient.invalidateQueries({ queryKey: ['claude-code-session-transcript', params.sessionId] }),
            ]);
            const workspaces = await queryClient.fetchQuery(claudeCodeWorkspacesQueryOptions());
            if (
                shouldNavigateToSourceIndexAfterDelete(
                    workspaces,
                    detail.session.workspaceKey,
                    (workspace) => workspace.key,
                )
            ) {
                navigate({ to: '/claude-code' });
                return;
            }
            navigate({
                params: { workspaceKey: detail.session.workspaceKey },
                search: merged ? { merged: true } : undefined,
                to: '/claude-code/$workspaceKey',
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
                            { label: 'Claude Code', to: '/claude-code' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
                                search: merged ? { merged: true } : undefined,
                                to: '/claude-code/$workspaceKey',
                            },
                            { label: detail.session.title },
                        ]}
                    />
                }
                eyebrow="Claude Code session"
                subtitle="Session detail for the selected Claude Code project conversation."
                title={detail.session.title}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.session.messageCount)} />
                <MetricCard label="Tool calls" value={formatNumber(detail.session.toolCallCount)} />
                <MetricCard label="Tool outputs" value={formatNumber(detail.session.toolResultCount)} />
                <MetricCard label="Tokens" value={formatTokens(detail.session.totalTokens)} />
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
                    {initialDetail.isPartial ? (
                        <ClaudeCodeTranscriptPreviewNotice
                            fullTranscriptLoaded={Boolean(fullTranscriptQuery.data)}
                            omittedEntryCount={initialDetail.omittedEntryCount ?? 0}
                            pending={fullTranscriptQuery.isFetching}
                            onLoad={() => setShouldLoadFullTranscript(true)}
                        />
                    ) : null}
                    {fullTranscriptQuery.isError ? (
                        <p className="text-[var(--destructive)] text-sm">
                            Failed to load the full transcript:{' '}
                            {fullTranscriptQuery.error instanceof Error
                                ? fullTranscriptQuery.error.message
                                : 'Unknown error'}
                        </p>
                    ) : null}
                    {transcriptEvents.length > 0 ? (
                        <TranscriptView
                            assistantModel={detail.session.model}
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
                            <h3 className="font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-[0.18em]">
                                Transcript
                            </h3>
                            <p className="mt-3 text-[var(--muted-foreground)] text-sm">
                                No renderable Claude Code transcript content was found for this session.
                            </p>
                        </section>
                    )}
                </TabsContent>

                <TabsContent value="metadata">
                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                        <MetadataSection items={buildSessionMetadata(detail, merged)} title="Session metadata" />
                        <MetadataSection
                            items={buildTranscriptStatsItems(detail, transcriptEvents, transcriptStats)}
                            title="Transcript stats"
                        />
                    </div>
                </TabsContent>

                <TabsContent value="raw">
                    <ClaudeCodeRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            <ExportDialog
                focusedEvidenceTarget={{ id: detail.session.sessionId, merged, source: 'claude-code' }}
                errorMessage={getMutationErrorMessage(exportSessionMutation.error, 'Export failed')}
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
                description={
                    merged
                        ? 'Permanently delete this merged Claude Code conversation from disk. This removes every physical continuation segment.'
                        : 'Permanently delete this Claude Code session from disk. This removes the session JSONL file.'
                }
                errorMessage={getMutationErrorMessage(deleteSessionMutation.error, 'Session delete failed')}
                open={deleteOpen}
                title="Delete this Claude Code session?"
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
}
