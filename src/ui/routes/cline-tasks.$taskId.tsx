import type { ClineTaskTranscript } from '@spiracha/lib/cline-exporter-types';
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
import { RouteErrorPanel } from '#/components/route-error-panel';
import { TranscriptControls } from '#/components/transcript-controls';
import { DEFAULT_SHOW_USER_MESSAGES, TranscriptView } from '#/components/transcript-view';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { clineTaskDetailQueryOptions, clineWorkspacesQueryOptions } from '#/lib/cline-queries';
import { deleteClineTaskFn, exportClineTaskFn } from '#/lib/cline-server';
import { clineTranscriptToThreadEvents, getClineThreadTranscriptStats } from '#/lib/cline-transcript-events';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import type { ExportDialogOptions } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { RouteStateResetBoundary } from '#/lib/route-state-reset';
import { shouldNavigateToSourceIndexAfterDelete } from '#/lib/workspace-delete-navigation';

const metadataItems = (detail: ClineTaskTranscript) => [
    { label: 'Task ID', value: <span data-mono="true">{detail.task.taskId}</span> },
    { label: 'ULID', value: detail.task.ulid ?? 'unknown' },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.task.workspaceKey }}
                to="/cline/$workspaceKey"
            >
                {detail.task.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.task.worktree },
    { label: 'Model', value: detail.task.modelId ?? 'unknown' },
    { label: 'Favorite', value: detail.task.isFavorited ? 'yes' : 'no' },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(detail.task.createdAtMs)}</span> },
    { label: 'Updated', value: <span suppressHydrationWarning>{formatDateTime(detail.task.lastActiveAtMs)}</span> },
];

const statsItems = (detail: ClineTaskTranscript, events: ThreadEvent[], stats: ThreadTranscriptStats) => [
    { label: 'Event kinds', value: formatList([...new Set(events.map((event) => event.kind))]) },
    { label: 'Messages', value: formatNumber(stats.messageCount) },
    { label: 'User messages', value: formatNumber(stats.userMessageCount) },
    { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
    { label: 'Reasoning events', value: formatNumber(detail.task.reasoningCount) },
    { label: 'Final answers', value: formatNumber(stats.finalAnswerCount) },
    { label: 'Tool calls', value: formatNumber(stats.toolCallCount) },
    { label: 'Tool outputs', value: formatNumber(stats.toolOutputCount) },
];

const ClineTaskDetailPage = () => {
    const downloadCancellation = useDownloadCancellation();
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const detail = useSuspenseQuery(clineTaskDetailQueryOptions(Route.useParams().taskId)).data;
    const events = useMemo(() => clineTranscriptToThreadEvents(detail), [detail]);
    const stats = useMemo(() => getClineThreadTranscriptStats(events), [events]);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(DEFAULT_SHOW_USER_MESSAGES);
    const exportMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportClineTaskFn({ data: { ...options, taskId: detail.task.taskId } });
            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
            } else {
                await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl);
            }
        },
        onSuccess: () => setExportOpen(false),
    });
    const deleteMutation = useMutation({
        mutationFn: () => deleteClineTaskFn({ data: { taskId: detail.task.taskId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['cline-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['cline-tasks', detail.task.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['cline-task', detail.task.taskId] }),
            ]);
            const workspaces = await queryClient.fetchQuery(clineWorkspacesQueryOptions());
            if (
                shouldNavigateToSourceIndexAfterDelete(
                    workspaces,
                    detail.task.workspaceKey,
                    (workspace) => workspace.key,
                )
            ) {
                await navigate({ to: '/cline' });
            } else {
                await navigate({ params: { workspaceKey: detail.task.workspaceKey }, to: '/cline/$workspaceKey' });
            }
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
                            onClick={() => setExportOpen(true)}
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
                            { label: 'Cline', to: '/cline' },
                            {
                                label: detail.task.workspaceLabel,
                                params: { workspaceKey: detail.task.workspaceKey },
                                to: '/cline/$workspaceKey',
                            },
                            { label: detail.task.title },
                        ]}
                    />
                }
                eyebrow="Cline chat"
                subtitle="Visible transcript reconstructed from Cline's local UI message history."
                title={detail.task.title}
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.task.messageCount)} />
                <MetricCard label="Tool calls" value={formatNumber(detail.task.toolCallCount)} />
                <MetricCard label="Reasoning" value={formatNumber(detail.task.reasoningCount)} />
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
                        rawJsonDisabled={Boolean(detail.rawPayloadsOmitted) || events.length === 0}
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
                    <TranscriptView
                        assistantModel={detail.task.modelId}
                        events={events}
                        projectPath={detail.task.worktree}
                        showCommentary={showCommentary}
                        showExtraEvents={showExtraEvents}
                        showRawJson={showRawJson && !detail.rawPayloadsOmitted}
                        showToolCalls={showToolCalls}
                        showUserMessages={showUserMessages}
                    />
                </TabsContent>
                <TabsContent value="metadata">
                    <div className="grid gap-4 xl:grid-cols-2">
                        <MetadataSection items={metadataItems(detail)} title="Chat metadata" />
                        <MetadataSection items={statsItems(detail, events, stats)} title="Transcript stats" />
                    </div>
                </TabsContent>
                <TabsContent className="space-y-4" value="raw">
                    <JsonPanel title="Task summary" value={detail.task} />
                    <JsonPanel title="Cline UI messages" value={detail.messages} />
                    <JsonPanel title="Transcript events" value={events} />
                </TabsContent>
            </Tabs>
            <ExportDialog
                focusedEvidenceTarget={{ id: detail.task.taskId, source: 'cline' }}
                errorMessage={exportMutation.isError ? exportMutation.error.message : null}
                open={exportOpen}
                pending={exportMutation.isPending}
                title={`Export ${detail.task.title}`}
                onExport={(options) => exportMutation.mutate(options)}
                onOpenChange={(open) => setExportOpen(open)}
            />
            <DeleteConfirmDialog
                confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete chat'}
                description={`Permanently delete "${detail.task.title}" from Cline task history and remove its task directory.`}
                errorMessage={deleteMutation.isError ? deleteMutation.error.message : null}
                open={deleteOpen}
                title="Delete this Cline chat?"
                onConfirm={() => deleteMutation.mutate()}
                onOpenChange={(open) => setDeleteOpen(open)}
            />
        </div>
    );
};

export const Route = createFileRoute('/cline-tasks/$taskId')({
    component: () => (
        <RouteStateResetBoundary routeKey={Route.useParams().taskId}>
            <ClineTaskDetailPage />
        </RouteStateResetBoundary>
    ),
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Cline chat" />,
    loader: ({ context, params }) => context.queryClient.ensureQueryData(clineTaskDetailQueryOptions(params.taskId)),
    pendingComponent: () => <LoadingPanel description="Loading Cline transcript and metadata." title="Loading chat" />,
});
