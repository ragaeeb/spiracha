import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Download, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
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
    cursorThreadDetailQueryOptions,
    cursorThreadTranscriptQueryOptions,
    cursorWorkspacesQueryOptions,
} from '#/lib/cursor-queries';
import {
    deleteCursorThreadsFn,
    exportCursorThreadFn,
    type getCursorThreadDetailFn,
    type getCursorThreadTranscriptFn,
} from '#/lib/cursor-server';
import { cursorTranscriptToThreadEvents, getCursorThreadTranscriptStats } from '#/lib/cursor-transcript-events';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import type { ExportDialogOptions } from '#/lib/export-options';
import { formatBytes, formatDateTime, formatList, formatModelLabel, formatNumber } from '#/lib/formatters';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import {
    getTranscriptDisplayState,
    parseThreadTranscriptSearch,
    type ThreadTranscriptSearch,
    withThreadTranscriptSearch,
} from '#/lib/route-search';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { useClientReady } from '#/lib/use-client-ready';
import { shouldNavigateToSourceIndexAfterDelete } from '#/lib/workspace-delete-navigation';

type CursorThreadMetadata = Awaited<ReturnType<typeof getCursorThreadDetailFn>>;
type CursorThreadTranscript = Awaited<ReturnType<typeof getCursorThreadTranscriptFn>>;
type CursorThreadDetail = CursorThreadMetadata & { transcript: CursorThreadTranscript };

const buildCursorThreadMetadata = (detail: CursorThreadDetail) => {
    return [
        { label: 'Composer ID', value: <span data-mono="true">{detail.thread.composerId}</span> },
        {
            label: 'Workspace',
            value: (
                <Link
                    className="text-[var(--accent)]"
                    params={{ workspaceKey: detail.thread.workspaceKey }}
                    to="/cursor/$workspaceKey"
                >
                    {detail.thread.workspaceLabel}
                </Link>
            ),
        },
        { label: 'Workspace key', value: <span data-mono="true">{detail.thread.workspaceKey}</span> },
        { label: 'Mode', value: detail.thread.mode ?? 'unknown' },
        { label: 'Storage status', value: detail.thread.status ?? 'unknown' },
        {
            label: 'Moved snapshots',
            value: detail.thread.snapshotCount > 1 ? formatNumber(detail.thread.snapshotCount) : 'n/a',
        },
        { label: 'Model', value: detail.thread.model ? formatModelLabel(detail.thread.model) : 'unknown' },
        { label: 'Reasoning', value: detail.thread.reasoningEffort ?? 'unknown' },
        {
            label: 'Created',
            value: <span suppressHydrationWarning>{formatDateTime(detail.thread.createdAtMs)}</span>,
        },
        {
            label: 'Updated',
            value: <span suppressHydrationWarning>{formatDateTime(detail.thread.lastUpdatedAtMs)}</span>,
        },
        {
            label: 'Transcript dirs',
            value:
                detail.thread.transcriptDirs.length > 0 ? (
                    <div className="space-y-1">
                        {detail.thread.transcriptDirs.map((directory) => (
                            <div data-mono="true" key={directory}>
                                {directory}
                            </div>
                        ))}
                    </div>
                ) : (
                    'n/a'
                ),
        },
    ];
};

const CursorMovedSnapshotNotice = ({ thread }: { thread: CursorThreadMetadata['thread'] }) => {
    if (thread.snapshotCount <= 1 || !thread.latestSnapshotComposerId) {
        return null;
    }

    const isLatest = thread.latestSnapshotComposerId === thread.composerId;
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-4 text-sm" role="status">
            <p className="font-medium">{isLatest ? 'Latest moved Cursor snapshot' : 'Older moved Cursor snapshot'}</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
                Cursor created {formatNumber(thread.snapshotCount)} physical records while moving this conversation
                between workspaces.{' '}
                {isLatest ? 'This is the latest record.' : 'This record ends before the latest one.'}
            </p>
            {!isLatest ? (
                <Link
                    className="mt-2 inline-block text-[var(--accent)] underline-offset-2 hover:underline"
                    params={{ composerId: thread.latestSnapshotComposerId }}
                    to="/cursor-threads/$composerId"
                >
                    Open latest snapshot
                </Link>
            ) : null}
        </div>
    );
};

const buildCursorTranscriptStatsItems = (
    detail: CursorThreadDetail,
    events: ThreadEvent[],
    stats: ThreadTranscriptStats,
) => {
    if (!detail.transcript) {
        return [{ label: 'Transcript load', value: 'No renderable Cursor transcript content was found.' }];
    }

    return [
        { label: 'Event kinds', value: formatList([...new Set(events.map((event) => event.kind))]) },
        { label: 'Messages', value: formatNumber(stats.messageCount) },
        { label: 'User messages', value: formatNumber(stats.userMessageCount) },
        { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
        { label: 'Commentary updates', value: formatNumber(stats.commentaryCount) },
        { label: 'Tool calls', value: formatNumber(stats.toolCallCount) },
        { label: 'Tool outputs', value: formatNumber(stats.toolOutputCount) },
        { label: 'Renderable bubbles', value: formatNumber(detail.transcript.renderableBubbleCount) },
        { label: 'Omitted bubbles', value: formatNumber(detail.transcript.omittedBubbleCount) },
    ];
};

const CursorThreadMetadataPanels = ({
    detail,
    events,
    stats,
}: {
    detail: CursorThreadDetail;
    events: ThreadEvent[];
    stats: ThreadTranscriptStats;
}) => {
    return (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <MetadataSection items={buildCursorThreadMetadata(detail)} title="Thread metadata" />
            <MetadataSection items={buildCursorTranscriptStatsItems(detail, events, stats)} title="Transcript stats" />
        </div>
    );
};

const CursorThreadRawPanels = ({ detail, events }: { detail: CursorThreadDetail; events: ThreadEvent[] }) => {
    if (!detail.transcript) {
        return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-5 py-4 text-sm">
                No Cursor transcript payload was found for this thread.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <JsonPanel title="Thread summary" value={detail.thread} />
            <JsonPanel title="Transcript head" value={detail.transcript.head} />
            <JsonPanel title="Cursor bubbles" value={detail.transcript.bubbles} />
            <JsonPanel title="Transcript events" value={events} />
        </div>
    );
};

const CursorThreadDetailErrorComponent = ({ error }: { error: Error }) => {
    return <RouteErrorPanel error={error} title="Failed to load Cursor thread" />;
};

const CursorThreadMetrics = ({ detail }: { detail: CursorThreadDetail }) => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Stored bubbles" value={formatNumber(detail.thread.bubbleCount)} />
        <MetricCard label="Size" value={formatBytes(detail.thread.bubbleBytes)} />
        <MetricCard
            helper={detail.thread.reasoningEffort ? `${detail.thread.reasoningEffort} reasoning` : undefined}
            label="Model"
            value={detail.thread.model ? formatModelLabel(detail.thread.model) : 'unknown'}
        />
        <MetricCard
            helper={`${formatNumber(detail.transcript?.renderableBubbleCount ?? 0)} renderable`}
            label="Omitted"
            value={formatNumber(detail.transcript?.omittedBubbleCount ?? 0)}
        />
    </div>
);

const CursorTranscriptContent = ({
    clientReady,
    detail,
    events,
    isError,
    isPending,
    queryError,
    transcriptDisplay,
    updateTranscriptDisplay,
}: {
    clientReady: boolean;
    detail: CursorThreadDetail;
    events: ThreadEvent[];
    isError: boolean;
    isPending: boolean;
    queryError: unknown;
    transcriptDisplay: ReturnType<typeof getTranscriptDisplayState>;
    updateTranscriptDisplay: (patch: Partial<ThreadTranscriptSearch>) => void;
}) => {
    const { showCommentary, showExtraEvents, showRawJson, showToolCalls, showUserMessages } = transcriptDisplay;
    let content: ReactNode;
    if (!clientReady || isPending) {
        content = <LoadingPanel description="Loading the Cursor transcript body." title="Loading transcript" />;
    } else if (isError) {
        content = (
            <RouteErrorPanel
                error={queryError instanceof Error ? queryError : new Error('Failed to load Cursor transcript')}
                title="Failed to load Cursor transcript"
            />
        );
    } else if (detail.transcript && events.length > 0) {
        content = (
            <TranscriptView
                assistantModel={detail.thread.model}
                events={events}
                projectPath={null}
                showCommentary={showCommentary}
                showExtraEvents={showExtraEvents}
                showRawJson={showRawJson}
                showToolCalls={showToolCalls}
                showUserMessages={showUserMessages}
            />
        );
    } else {
        content = (
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
                <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                    Transcript
                </h3>
                <p className="mt-3 text-[var(--muted-foreground)] text-sm">
                    No renderable Cursor transcript content was found for this thread.
                </p>
            </section>
        );
    }

    return (
        <TabsContent className="space-y-3" value="transcript">
            <TranscriptControls
                rawJsonDisabled={!detail.transcript}
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
            {content}
        </TabsContent>
    );
};

const CursorThreadDetailPage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const transcriptSearch = Route.useSearch();
    const transcriptDisplay = getTranscriptDisplayState(transcriptSearch);
    const composerId = Route.useParams().composerId;
    const metadata = useSuspenseQuery(cursorThreadDetailQueryOptions(composerId)).data;
    const clientReady = useClientReady();
    const transcriptQuery = useQuery({
        ...cursorThreadTranscriptQueryOptions(composerId),
        enabled: clientReady,
    });
    const detail: CursorThreadDetail = { ...metadata, transcript: transcriptQuery.data ?? null };
    const [pendingDelete, setPendingDelete] = useState(false);
    const [pendingExport, setPendingExport] = useState(false);
    const updateTranscriptDisplay = (patch: Partial<ThreadTranscriptSearch>) => {
        void navigate({
            replace: true,
            search: (previous: Record<string, unknown>) => withThreadTranscriptSearch(previous, patch),
        });
    };
    const transcriptEvents = useMemo(
        () => (detail.transcript ? cursorTranscriptToThreadEvents(detail.transcript) : []),
        [detail.transcript],
    );
    const transcriptStats = useMemo(() => getCursorThreadTranscriptStats(transcriptEvents), [transcriptEvents]);

    const deleteThreadMutation = useMutation({
        mutationFn: (deleteSessionFiles: boolean) =>
            deleteCursorThreadsFn({ data: { composerIds: [detail.thread.composerId], deleteSessionFiles } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['cursor-thread', detail.thread.composerId] }),
                queryClient.invalidateQueries({
                    queryKey: ['cursor-thread-transcript', detail.thread.composerId],
                }),
                queryClient.invalidateQueries({ queryKey: ['cursor-threads', detail.thread.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['cursor-workspaces'] }),
            ]);
            const workspaces = await queryClient.fetchQuery(cursorWorkspacesQueryOptions());
            if (
                shouldNavigateToSourceIndexAfterDelete(
                    workspaces,
                    detail.thread.workspaceKey,
                    (workspace) => workspace.key,
                )
            ) {
                await navigate({ to: '/cursor' });
                return;
            }
            await navigate({
                params: { workspaceKey: detail.thread.workspaceKey },
                to: '/cursor/$workspaceKey',
            });
        },
    });

    const exportThreadMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportCursorThreadFn({
                data: {
                    ...options,
                    composerId: detail.thread.composerId,
                },
            });

            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
                return;
            }

            await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl);
        },
        onSuccess: () => {
            setPendingExport(false);
        },
    });

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <div className="flex flex-wrap gap-2">
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
                            onClick={() => setPendingDelete(true)}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete
                        </Button>
                    </div>
                }
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'Cursor', to: '/cursor' },
                            {
                                label: detail.thread.workspaceLabel,
                                params: { workspaceKey: detail.thread.workspaceKey },
                                to: '/cursor/$workspaceKey',
                            },
                            { label: detail.thread.name },
                        ]}
                    />
                }
                eyebrow="Cursor thread"
                subtitle="Thread detail for the selected Cursor workspace conversation."
                title={detail.thread.name}
            />

            <CursorMovedSnapshotNotice thread={detail.thread} />

            <CursorThreadMetrics detail={detail} />

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

                <CursorTranscriptContent
                    clientReady={clientReady}
                    detail={detail}
                    events={transcriptEvents}
                    isError={transcriptQuery.isError}
                    isPending={transcriptQuery.isPending}
                    queryError={transcriptQuery.error}
                    transcriptDisplay={transcriptDisplay}
                    updateTranscriptDisplay={updateTranscriptDisplay}
                />

                <TabsContent value="metadata">
                    <CursorThreadMetadataPanels detail={detail} events={transcriptEvents} stats={transcriptStats} />
                </TabsContent>

                <TabsContent value="raw">
                    <CursorThreadRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            <DeleteConfirmDialog
                confirmLabel={deleteThreadMutation.isPending ? 'Deleting...' : 'Delete thread'}
                defaultDeleteSessionFiles
                deleteSessionFilesDescription="Also remove Cursor's on-disk agent transcript directory. Clear this option to preserve those source files; preserved files can make the conversation discoverable again."
                deleteSessionFilesLabel="Delete Cursor transcript files"
                description={`Permanently delete "${detail.thread.name}" from Cursor's database. Quit Cursor first. This cannot be undone.`}
                errorMessage={getMutationErrorMessage(deleteThreadMutation.error, 'Delete failed')}
                open={pendingDelete}
                showDeleteSessionFilesOption
                title="Delete Cursor thread?"
                onConfirm={({ deleteSessionFiles }) => deleteThreadMutation.mutate(deleteSessionFiles)}
                onOpenChange={(nextOpen) => {
                    setPendingDelete(nextOpen);
                    if (!nextOpen) {
                        deleteThreadMutation.reset();
                    }
                }}
            />

            <ExportDialog
                focusedEvidenceTarget={{ id: detail.thread.composerId, source: 'cursor' }}
                errorMessage={getMutationErrorMessage(exportThreadMutation.error, 'Export failed')}
                open={pendingExport}
                pending={exportThreadMutation.isPending}
                title={`Export ${detail.thread.name}`}
                onExport={(options) => exportThreadMutation.mutate(options)}
                onOpenChange={(nextOpen) => {
                    setPendingExport(nextOpen);
                    if (!nextOpen) {
                        exportThreadMutation.reset();
                    }
                }}
            />
        </div>
    );
};

export const Route = createFileRoute('/cursor-threads/$composerId')({
    component: () => {
        const { composerId } = Route.useParams();
        return (
            <RouteStateResetBoundary routeKey={composerId}>
                <CursorThreadDetailPage />
            </RouteStateResetBoundary>
        );
    },
    errorComponent: CursorThreadDetailErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(cursorThreadDetailQueryOptions(params.composerId)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the Cursor transcript, thread metadata, and workspace context."
            title="Loading thread"
        />
    ),
    validateSearch: parseThreadTranscriptSearch,
});
