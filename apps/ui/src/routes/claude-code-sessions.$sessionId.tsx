import type { ClaudeCodeSessionTranscript } from '@spiracha/lib/claude-code-exporter-types';
import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
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
import { claudeCodeSessionDetailQueryOptions } from '#/lib/claude-code-queries';
import { exportClaudeCodeSessionFn } from '#/lib/claude-code-server';
import {
    claudeCodeTranscriptToThreadEvents,
    getClaudeCodeThreadTranscriptStats,
} from '#/lib/claude-code-transcript-events';
import { downloadTextFile } from '#/lib/download';
import { formatDateTime, formatList, formatNumber, formatTokens } from '#/lib/formatters';

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

export const Route = createFileRoute('/claude-code-sessions/$sessionId')({
    component: ClaudeCodeSessionDetailPage,
    errorComponent: ClaudeCodeSessionDetailErrorComponent,
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(claudeCodeSessionDetailQueryOptions(params.sessionId)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the Claude Code transcript, messages, tool calls, and session metadata."
            title="Loading session"
        />
    ),
});

function ClaudeCodeSessionDetailErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Claude Code session" />;
}

const buildSessionMetadata = (detail: ClaudeCodeSessionTranscript) => [
    { label: 'Session ID', value: <span data-mono="true">{detail.session.sessionId}</span> },
    {
        label: 'Workspace',
        value: (
            <Link
                className="text-[var(--accent)]"
                params={{ workspaceKey: detail.session.workspaceKey }}
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

const ClaudeCodeTranscriptControls = ({
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
                    id="claude-code-transcript-show-tool-calls"
                    onCheckedChange={(checked) => onShowToolCallsChange(checked === true)}
                />
                <label htmlFor="claude-code-transcript-show-tool-calls">Show tool calls</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showCommentary}
                    id="claude-code-transcript-show-commentary"
                    onCheckedChange={(checked) => onShowCommentaryChange(checked === true)}
                />
                <label htmlFor="claude-code-transcript-show-commentary">Show commentary</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showExtraEvents}
                    id="claude-code-transcript-show-extra-events"
                    onCheckedChange={(checked) => onShowExtraEventsChange(checked === true)}
                />
                <label htmlFor="claude-code-transcript-show-extra-events">Show extra events</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showRawJson}
                    disabled={rawJsonDisabled}
                    id="claude-code-transcript-show-raw-json"
                    onCheckedChange={(checked) => onShowRawJsonChange(checked === true)}
                />
                <label htmlFor="claude-code-transcript-show-raw-json">Raw JSON</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showUserMessages}
                    id="claude-code-transcript-show-user-messages"
                    onCheckedChange={(checked) => onShowUserMessagesChange(checked === true)}
                />
                <label htmlFor="claude-code-transcript-show-user-messages">User</label>
            </div>
        </div>
    );
};

function ClaudeCodeRawPanels({ detail, events }: { detail: ClaudeCodeSessionTranscript; events: ThreadEvent[] }) {
    return (
        <div className="space-y-4">
            <JsonPanel title="Session summary" value={detail.session} />
            <JsonPanel title="Claude Code entries" value={detail.entries} />
            <JsonPanel title="Raw JSONL events" value={detail.rawEvents} />
            <JsonPanel title="Transcript events" value={events} />
        </div>
    );
}

function ClaudeCodeSessionDetailPage() {
    const detail = useSuspenseQuery(claudeCodeSessionDetailQueryOptions(Route.useParams().sessionId)).data;
    const [pendingExport, setPendingExport] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(true);
    const transcriptEvents = useMemo(() => claudeCodeTranscriptToThreadEvents(detail), [detail]);
    const transcriptStats = useMemo(() => getClaudeCodeThreadTranscriptStats(transcriptEvents), [transcriptEvents]);

    const exportSessionMutation = useMutation({
        mutationFn: async (options: ExportDialogOptions) => {
            const download = await exportClaudeCodeSessionFn({
                data: {
                    includeCommentary: options.includeCommentary,
                    includeMetadata: options.includeMetadata,
                    includeTools: options.includeTools,
                    outputFormat: options.outputFormat,
                    sessionId: detail.session.sessionId,
                },
            });
            downloadTextFile(download.fileName, download.content, download.mimeType);
        },
        onSuccess: () => {
            setPendingExport(false);
        },
    });

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <Button
                        className="rounded-full"
                        type="button"
                        variant="outline"
                        onClick={() => setPendingExport(true)}
                    >
                        <Download className="mr-2 size-4" />
                        Export
                    </Button>
                }
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'Claude Code', to: '/claude-code' },
                            {
                                label: detail.session.workspaceLabel,
                                params: { workspaceKey: detail.session.workspaceKey },
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
                    <ClaudeCodeTranscriptControls
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
                            assistantModel={detail.session.model}
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
                                No renderable Claude Code transcript content was found for this session.
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
                    <ClaudeCodeRawPanels detail={detail} events={transcriptEvents} />
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
        </div>
    );
}
