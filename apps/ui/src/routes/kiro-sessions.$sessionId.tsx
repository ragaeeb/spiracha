import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import type { KiroSessionTranscript } from '@spiracha/lib/kiro-exporter-types';
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
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { kiroSessionDetailQueryOptions } from '#/lib/kiro-queries';
import { deleteKiroSessionFn, exportKiroSessionFn } from '#/lib/kiro-server';
import { getKiroThreadTranscriptStats, kiroTranscriptToThreadEvents } from '#/lib/kiro-transcript-events';

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

const KiroSessionDetailErrorComponent = ({ error }: { error: Error }) => {
    return <ReloadErrorPanel description={error.message} title="Failed to load Kiro session" />;
};

const getKiroModelLabel = (detail: KiroSessionTranscript): string => {
    return detail.session.selectedModel ?? detail.session.defaultModelTitle ?? 'unknown';
};

const buildSessionMetadata = (detail: KiroSessionTranscript) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
                to="/kiro/$workspaceKey"
            >
                {detail.session.workspaceLabel}
            </Link>
        ),
    },
    { label: 'Worktree', value: detail.session.worktree },
    { label: 'Workspace path', value: detail.session.workspacePath ?? 'unknown' },
    { label: 'Workspace directory', value: detail.session.workspaceDirectory ?? 'unknown' },
    { label: 'Selected model', value: detail.session.selectedModel ?? 'unknown' },
    { label: 'Default model', value: detail.session.defaultModelTitle ?? 'unknown' },
    { label: 'Profile', value: detail.session.selectedProfileId ?? 'unknown' },
    { label: 'Autonomy mode', value: detail.session.autonomyMode ?? 'unknown' },
    { label: 'Session type', value: detail.session.sessionType ?? 'unknown' },
    { label: 'Created', value: <span suppressHydrationWarning>{formatDateTime(detail.session.createdAtMs)}</span> },
    {
        label: 'Last active',
        value: <span suppressHydrationWarning>{formatDateTime(detail.session.lastActiveAtMs)}</span>,
    },
    { label: 'Source file', value: detail.session.filePath },
];

const buildTranscriptStatsItems = (
    detail: KiroSessionTranscript,
    events: ThreadEvent[],
    stats: ThreadTranscriptStats,
) => [
    { label: 'Event kinds', value: formatList([...new Set(events.map((event) => event.kind))]) },
    { label: 'Messages', value: formatNumber(stats.messageCount) },
    { label: 'User messages', value: formatNumber(stats.userMessageCount) },
    { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
    { label: 'Final answers', value: formatNumber(stats.finalAnswerCount) },
    { label: 'Images', value: formatNumber(detail.session.imageCount) },
    { label: 'Prompt logs', value: formatNumber(detail.session.promptLogCount) },
    { label: 'Renderable parts', value: formatNumber(detail.renderablePartCount) },
];

const KiroTranscriptControls = ({
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
                    id="kiro-transcript-show-tool-calls"
                    onCheckedChange={(checked) => onShowToolCallsChange(checked === true)}
                />
                <label htmlFor="kiro-transcript-show-tool-calls">Show tool calls</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showCommentary}
                    id="kiro-transcript-show-commentary"
                    onCheckedChange={(checked) => onShowCommentaryChange(checked === true)}
                />
                <label htmlFor="kiro-transcript-show-commentary">Show commentary</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showExtraEvents}
                    id="kiro-transcript-show-extra-events"
                    onCheckedChange={(checked) => onShowExtraEventsChange(checked === true)}
                />
                <label htmlFor="kiro-transcript-show-extra-events">Show extra events</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showRawJson}
                    disabled={rawJsonDisabled}
                    id="kiro-transcript-show-raw-json"
                    onCheckedChange={(checked) => onShowRawJsonChange(checked === true)}
                />
                <label htmlFor="kiro-transcript-show-raw-json">Raw JSON</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showUserMessages}
                    id="kiro-transcript-show-user-messages"
                    onCheckedChange={(checked) => onShowUserMessagesChange(checked === true)}
                />
                <label htmlFor="kiro-transcript-show-user-messages">User</label>
            </div>
        </div>
    );
};

const KiroRawPanels = ({ detail, events }: { detail: KiroSessionTranscript; events: ThreadEvent[] }) => {
    return (
        <div className="space-y-4">
            <JsonPanel title="Session summary" value={detail.session} />
            <JsonPanel title="Kiro entries" value={detail.entries} />
            <JsonPanel title="Raw Kiro session" value={detail.rawSession} />
            <JsonPanel title="Transcript events" value={events} />
        </div>
    );
};

const KiroSessionDetailPage = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const detail = useSuspenseQuery(kiroSessionDetailQueryOptions(Route.useParams().sessionId)).data;
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [pendingExport, setPendingExport] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(true);
    const transcriptEvents = useMemo(() => kiroTranscriptToThreadEvents(detail), [detail]);
    const transcriptStats = useMemo(() => getKiroThreadTranscriptStats(transcriptEvents), [transcriptEvents]);
    const modelLabel = getKiroModelLabel(detail);

    const exportSessionMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportKiroSessionFn({
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
        mutationFn: () => deleteKiroSessionFn({ data: { sessionId: detail.session.sessionId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['kiro-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['kiro-sessions', detail.session.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['kiro-session', detail.session.sessionId] }),
            ]);
            navigate({
                params: { workspaceKey: detail.session.workspaceKey },
                to: '/kiro/$workspaceKey',
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
                            { label: 'Kiro', to: '/kiro' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
                                to: '/kiro/$workspaceKey',
                            },
                            { label: detail.session.title },
                        ]}
                    />
                }
                eyebrow="Kiro session"
                subtitle="Session detail for the selected Kiro workspace conversation."
                title={detail.session.title}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Messages" value={formatNumber(detail.session.messageCount)} />
                <MetricCard label="Images" value={formatNumber(detail.session.imageCount)} />
                <MetricCard label="Prompt logs" value={formatNumber(detail.session.promptLogCount)} />
                <MetricCard label="Model" value={modelLabel} />
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
                    <KiroTranscriptControls
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
                        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                                Transcript
                            </h3>
                            <p className="mt-4 text-[var(--muted-foreground)] text-sm">
                                No renderable Kiro transcript content was found for this session.
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
                    <KiroRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            <ExportDialog
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
                description="Permanently delete this Kiro session from disk. This removes the session JSON file and matching execution files."
                errorMessage={
                    deleteSessionMutation.isError
                        ? deleteSessionMutation.error instanceof Error
                            ? deleteSessionMutation.error.message
                            : 'Session delete failed'
                        : null
                }
                open={deleteOpen}
                title="Delete this Kiro session?"
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

export const Route = createFileRoute('/kiro-sessions/$sessionId')({
    component: KiroSessionDetailPage,
    errorComponent: KiroSessionDetailErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(kiroSessionDetailQueryOptions(params.sessionId)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the Kiro transcript, messages, attachments, and session metadata."
            title="Loading session"
        />
    ),
});
