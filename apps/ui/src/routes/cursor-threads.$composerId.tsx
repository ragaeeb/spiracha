import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
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
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { TranscriptView } from '#/components/transcript-view';
import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { cursorThreadDetailQueryOptions } from '#/lib/cursor-queries';
import { deleteCursorThreadsFn, exportCursorThreadFn, type getCursorThreadDetailFn } from '#/lib/cursor-server';
import { cursorTranscriptToThreadEvents, getCursorThreadTranscriptStats } from '#/lib/cursor-transcript-events';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { formatBytes, formatDateTime, formatList, formatNumber } from '#/lib/formatters';

type CursorThreadDetail = Awaited<ReturnType<typeof getCursorThreadDetailFn>>;

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
    zipArchive: boolean;
};

type TranscriptControlsProps = {
    rawJsonDisabled?: boolean;
    showCommentary: boolean;
    showExtraEvents: boolean;
    showRawJson: boolean;
    showToolCalls: boolean;
    showUserMessages: boolean;
    onShowCommentaryChange: (checked: boolean) => void;
    onShowExtraEventsChange: (checked: boolean) => void;
    onShowRawJsonChange: (checked: boolean) => void;
    onShowToolCallsChange: (checked: boolean) => void;
    onShowUserMessagesChange: (checked: boolean) => void;
};

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

const CursorTranscriptControls = ({
    rawJsonDisabled = false,
    showCommentary,
    showExtraEvents,
    showRawJson,
    showToolCalls,
    showUserMessages,
    onShowCommentaryChange,
    onShowExtraEventsChange,
    onShowRawJsonChange,
    onShowToolCallsChange,
    onShowUserMessagesChange,
}: TranscriptControlsProps) => {
    return (
        <div className="flex flex-wrap gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-[var(--panel-shadow)]">
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showToolCalls}
                    id="cursor-transcript-show-tool-calls"
                    onCheckedChange={(checked) => onShowToolCallsChange(checked === true)}
                />
                <label htmlFor="cursor-transcript-show-tool-calls">Show tool calls</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showCommentary}
                    id="cursor-transcript-show-commentary"
                    onCheckedChange={(checked) => onShowCommentaryChange(checked === true)}
                />
                <label htmlFor="cursor-transcript-show-commentary">Show commentary</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showExtraEvents}
                    id="cursor-transcript-show-extra-events"
                    onCheckedChange={(checked) => onShowExtraEventsChange(checked === true)}
                />
                <label htmlFor="cursor-transcript-show-extra-events">Show extra events</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showRawJson}
                    disabled={rawJsonDisabled}
                    id="cursor-transcript-show-raw-json"
                    onCheckedChange={(checked) => onShowRawJsonChange(checked === true)}
                />
                <label htmlFor="cursor-transcript-show-raw-json">Raw JSON</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showUserMessages}
                    id="cursor-transcript-show-user-messages"
                    onCheckedChange={(checked) => onShowUserMessagesChange(checked === true)}
                />
                <label htmlFor="cursor-transcript-show-user-messages">User</label>
            </div>
        </div>
    );
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
    return <ReloadErrorPanel description={error.message} title="Failed to load Cursor thread" />;
};

const CursorThreadDetailPage = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const detail = useSuspenseQuery(cursorThreadDetailQueryOptions(Route.useParams().composerId)).data;
    const [pendingDelete, setPendingDelete] = useState(false);
    const [pendingExport, setPendingExport] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(true);
    const transcriptEvents = useMemo(
        () => (detail.transcript ? cursorTranscriptToThreadEvents(detail.transcript) : []),
        [detail.transcript],
    );
    const transcriptStats = useMemo(() => getCursorThreadTranscriptStats(transcriptEvents), [transcriptEvents]);

    const deleteThreadMutation = useMutation({
        mutationFn: () => deleteCursorThreadsFn({ data: { composerIds: [detail.thread.composerId] } }),
        onSuccess: async () => {
            await navigate({
                params: { workspaceKey: detail.thread.workspaceKey },
                to: '/cursor/$workspaceKey',
            });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['cursor-thread', detail.thread.composerId] }),
                queryClient.invalidateQueries({ queryKey: ['cursor-threads', detail.thread.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['cursor-workspaces'] }),
            ]);
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

            await downloadUrlFile(download.fileName, download.downloadUrl);
        },
        onSuccess: () => {
            setPendingExport(false);
        },
    });

    return (
        <div className="space-y-6">
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

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.thread.bubbleCount)} />
                <MetricCard label="Size" value={formatBytes(detail.thread.bubbleBytes)} />
                <MetricCard label="Mode" value={detail.thread.mode ?? 'unknown'} />
                <MetricCard
                    helper={`${formatNumber(detail.transcript?.renderableBubbleCount ?? 0)} renderable`}
                    label="Omitted"
                    value={formatNumber(detail.transcript?.omittedBubbleCount ?? 0)}
                />
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
                    <CursorTranscriptControls
                        rawJsonDisabled={!detail.transcript}
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
                    {detail.transcript && transcriptEvents.length > 0 ? (
                        <TranscriptView
                            assistantModel={null}
                            events={transcriptEvents}
                            projectPath={null}
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
                                No renderable Cursor transcript content was found for this thread.
                            </p>
                        </section>
                    )}
                </TabsContent>

                <TabsContent value="metadata">
                    <CursorThreadMetadataPanels detail={detail} events={transcriptEvents} stats={transcriptStats} />
                </TabsContent>

                <TabsContent value="raw">
                    <CursorThreadRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            {deleteThreadMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {deleteThreadMutation.error instanceof Error ? deleteThreadMutation.error.message : 'Delete failed'}
                </p>
            ) : null}

            {exportThreadMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {exportThreadMutation.error instanceof Error ? exportThreadMutation.error.message : 'Export failed'}
                </p>
            ) : null}

            <DeleteConfirmDialog
                confirmLabel={deleteThreadMutation.isPending ? 'Deleting...' : 'Delete thread'}
                description={`Permanently delete "${detail.thread.name}" from Cursor's database and remove any on-disk transcript directories. Quit Cursor first. This cannot be undone.`}
                open={pendingDelete}
                title="Delete Cursor thread?"
                onConfirm={() => deleteThreadMutation.mutate()}
                onOpenChange={setPendingDelete}
            />

            <ExportDialog
                open={pendingExport}
                pending={exportThreadMutation.isPending}
                title={`Export ${detail.thread.name}`}
                onExport={(options) => exportThreadMutation.mutate(options)}
                onOpenChange={setPendingExport}
            />
        </div>
    );
};

export const Route = createFileRoute('/cursor-threads/$composerId')({
    component: CursorThreadDetailPage,
    errorComponent: CursorThreadDetailErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(cursorThreadDetailQueryOptions(params.composerId)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the Cursor transcript, thread metadata, and workspace context."
            title="Loading thread"
        />
    ),
});
