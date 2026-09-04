import type { CodexCloudTaskDetail } from '@spiracha/lib/codex-cloud';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Download, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { ExportDialog } from '#/components/export-dialog';
import { JsonPanel } from '#/components/json-panel';
import { LoadingPanel } from '#/components/loading-panel';
import { MetadataSection } from '#/components/metadata-section';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { ThreadToolsPanel } from '#/components/thread-tools-panel';
import { TranscriptControls } from '#/components/transcript-controls';
import {
    buildTranscriptSearchResults,
    TranscriptSearchPanel,
    useTranscriptSearchNavigation,
} from '#/components/transcript-search';
import { type TranscriptSortOrder, TranscriptView } from '#/components/transcript-view';
import { Button } from '#/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { codexCloudTaskQueryOptions } from '#/lib/codex-cloud-queries';
import { exportCodexCloudTaskFn } from '#/lib/codex-cloud-server';
import { downloadTextFile, downloadUrlFileWithCancellation, useDownloadCancellation } from '#/lib/download';
import type { ExportDialogOptions, ExportLifecycleCallbacks } from '#/lib/export-options';
import { formatDateTime, formatList, formatNumber } from '#/lib/formatters';
import { getMutationErrorMessage } from '#/lib/mutation-error';
import {
    getTranscriptDisplayState,
    parseThreadTranscriptSearch,
    type ThreadTranscriptSearch,
    withThreadTranscriptSearch,
} from '#/lib/route-search';

export const Route = createFileRoute('/codex/cloud/tasks/$taskId')({
    component: CodexCloudTaskPage,
    errorComponent: CodexCloudTaskErrorComponent,
    loader: ({ context, params }) => context.queryClient.ensureQueryData(codexCloudTaskQueryOptions(params.taskId)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the Cloud transcript, metadata, tools, and diff."
            title="Loading Cloud task"
        />
    ),
    validateSearch: parseThreadTranscriptSearch,
});

function CodexCloudTaskErrorComponent({ error }: { error: Error }) {
    return <RouteErrorPanel error={error} title="Failed to load Codex Cloud task" />;
}

const getSearchFilters = (search: ThreadTranscriptSearch) => getTranscriptDisplayState(search);

const buildMetadataItems = (detail: CodexCloudTaskDetail) => [
    { label: 'Task ID', value: detail.task.id },
    { label: 'Project', value: detail.projectLabel },
    { label: 'Environment ID', value: detail.environmentId ?? 'n/a' },
    { label: 'Status', value: detail.status ?? detail.task.status },
    { label: 'Branch', value: detail.branch ?? 'n/a' },
    { label: 'Turn ID', value: detail.currentTurnId ?? 'n/a' },
    {
        label: 'Codex Cloud',
        value: (
            <a
                className="text-[var(--accent)] hover:underline"
                href={detail.task.taskUrl}
                rel="noreferrer"
                target="_blank"
            >
                Open task
            </a>
        ),
    },
];

const buildStatsItems = (detail: CodexCloudTaskDetail) => {
    const stats = detail.events.reduce(
        (result, event) => {
            result[event.kind] = (result[event.kind] ?? 0) + 1;
            return result;
        },
        {} as Record<string, number>,
    );
    return [
        { label: 'Event kinds', value: formatList(Object.keys(stats).sort()) },
        { label: 'Total events', value: formatNumber(detail.events.length) },
        { label: 'Messages', value: formatNumber(stats.message ?? 0) },
        { label: 'Reasoning', value: formatNumber(stats.reasoning ?? 0) },
        { label: 'Tool calls', value: formatNumber(stats.tool_call ?? 0) },
        { label: 'Tool outputs', value: formatNumber(stats.tool_output ?? 0) },
        { label: 'Task completion events', value: formatNumber(stats.task_complete ?? 0) },
    ];
};

const DiffPanel = ({ detail }: { detail: CodexCloudTaskDetail }) => {
    const { filesModified, linesAdded, linesRemoved } = detail.diff.stats;
    return (
        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
            <div>
                <h3 className="font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-[0.18em]">
                    Cloud diff
                </h3>
                <p className="mt-2 text-sm">
                    {filesModified === null ? 'Files changed: n/a' : `Files changed: ${formatNumber(filesModified)}`}
                    {' · '}
                    {linesAdded === null ? 'additions: n/a' : `additions: +${formatNumber(linesAdded)}`}
                    {' · '}
                    {linesRemoved === null ? 'deletions: n/a' : `deletions: -${formatNumber(linesRemoved)}`}
                </p>
            </div>
            {detail.diff.patch ? (
                <pre className="max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--code-background)] p-3 text-[var(--code-foreground)] text-xs leading-5">
                    {detail.diff.patch}
                </pre>
            ) : (
                <p className="text-[var(--muted-foreground)] text-sm">
                    This task did not include a unified diff payload.
                </p>
            )}
        </section>
    );
};

function CodexCloudTaskPage() {
    const { taskId } = Route.useParams();
    const navigate = Route.useNavigate();
    const search = Route.useSearch();
    const detail = useSuspenseQuery(codexCloudTaskQueryOptions(taskId)).data;
    const downloadCancellation = useDownloadCancellation();
    const [exportOpen, setExportOpen] = useState(false);
    const filters = useMemo(() => getSearchFilters(search), [search]);
    const searchResults = useMemo(
        () => buildTranscriptSearchResults(detail.events, search.q ?? '', detail.model, filters, (text) => text),
        [detail.events, detail.model, filters, search.q],
    );
    const {
        activeEventKey,
        activeResultIndex,
        jumpSignal,
        jumpToResult,
        reset: resetSearchNavigation,
    } = useTranscriptSearchNavigation(searchResults);
    const sortOrder: TranscriptSortOrder = search.sort ?? 'earliest';

    const updateSearch = (patch: Partial<ThreadTranscriptSearch>) => {
        resetSearchNavigation();
        void navigate({
            replace: true,
            search: (current) => withThreadTranscriptSearch(current, patch),
        });
    };

    const exportMutation = useMutation({
        mutationFn: async (input: ExportDialogOptions & ExportLifecycleCallbacks) => {
            const { onDownloadStateChange, ...options } = input;
            const download = await exportCodexCloudTaskFn({
                data: {
                    ...options,
                    taskId: detail.task.id,
                },
            });
            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType, {
                    onStateChange: onDownloadStateChange,
                });
                return download;
            }
            await downloadUrlFileWithCancellation(downloadCancellation, download.fileName, download.downloadUrl, {
                onStateChange: onDownloadStateChange,
            });
            return download;
        },
        onSuccess: () => setExportOpen(false),
    });

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <>
                        <Button asChild className="rounded-full" variant="outline">
                            <a href={detail.task.taskUrl} rel="noreferrer" target="_blank">
                                <ExternalLink className="mr-2 size-4" />
                                Open in Cloud
                            </a>
                        </Button>
                        <Button className="rounded-full" variant="outline" onClick={() => setExportOpen(true)}>
                            <Download className="mr-2 size-4" />
                            Export
                        </Button>
                    </>
                }
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'Codex', to: '/codex' },
                            { label: 'Cloud', to: '/codex/cloud' },
                            {
                                label: detail.projectLabel,
                                to: `/codex/cloud/projects/${encodeURIComponent(detail.projectId)}`,
                            },
                            { label: detail.task.title, title: detail.task.title, truncate: true },
                        ]}
                    />
                }
                eyebrow="Codex Cloud task"
                subtitle="Read-only Cloud transcript and task metadata."
                title={detail.task.title}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Model" value={detail.model ?? 'n/a'} />
                <MetricCard label="State" value={detail.status ?? detail.task.status} />
                <MetricCard
                    label="Updated"
                    value={<span suppressHydrationWarning>{formatDateTime(detail.task.updatedAt)}</span>}
                />
                <MetricCard
                    label="Diff"
                    value={
                        detail.diff.stats.filesModified === null
                            ? 'n/a'
                            : `${formatNumber(detail.diff.stats.filesModified)} files`
                    }
                />
            </div>

            <Tabs className="space-y-3" defaultValue="transcript">
                <TabsList className="grid w-full grid-cols-5 rounded-full border border-[var(--border)] bg-[var(--panel)] p-1 xl:w-fit xl:min-w-[36rem]">
                    <TabsTrigger className="rounded-full px-4 text-sm" value="transcript">
                        Transcript
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-4 text-sm" value="tools">
                        Tools
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-4 text-sm" value="metadata">
                        Metadata
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-4 text-sm" value="diff">
                        Diff
                    </TabsTrigger>
                    <TabsTrigger className="rounded-full px-4 text-sm" value="raw">
                        Safe JSON
                    </TabsTrigger>
                </TabsList>

                <TabsContent className="space-y-3" value="transcript">
                    <TranscriptControls
                        showCommentary={filters.showCommentary}
                        showExtraEvents={filters.showExtraEvents}
                        showRawJson={filters.showRawJson}
                        showToolCalls={filters.showToolCalls}
                        showUserMessages={filters.showUserMessages}
                        onShowCommentaryChange={(commentary) => updateSearch({ commentary })}
                        onShowExtraEventsChange={(extra) => updateSearch({ extra })}
                        onShowRawJsonChange={(raw) => updateSearch({ raw })}
                        onShowToolCallsChange={(tools) => updateSearch({ tools })}
                        onShowUserMessagesChange={(user) => updateSearch({ user })}
                    />
                    <TranscriptSearchPanel
                        activeResultIndex={activeResultIndex}
                        query={search.q ?? ''}
                        results={searchResults}
                        onJumpToResult={jumpToResult}
                        onQueryChange={(query) => updateSearch({ q: query })}
                    />
                    <TranscriptView
                        activeEventJumpSignal={jumpSignal}
                        activeEventKey={activeEventKey}
                        assistantModel={detail.model}
                        events={detail.events}
                        projectPath={null}
                        showCommentary={filters.showCommentary}
                        showExtraEvents={filters.showExtraEvents}
                        showRawJson={filters.showRawJson}
                        showToolCalls={filters.showToolCalls}
                        showUserMessages={filters.showUserMessages}
                        sortOrder={sortOrder}
                        onSortOrderChange={(nextSort) => updateSearch({ sort: nextSort })}
                    />
                </TabsContent>

                <TabsContent value="tools">
                    <ThreadToolsPanel
                        assistantModel={detail.model}
                        availableTools={detail.availableTools}
                        events={detail.events}
                        projectPath={null}
                        showRawJson={filters.showRawJson}
                        sortOrder={sortOrder}
                        transcriptState="available"
                        onSortOrderChange={(nextSort) => updateSearch({ sort: nextSort })}
                    />
                </TabsContent>

                <TabsContent value="metadata">
                    <div className="grid gap-4 xl:grid-cols-2">
                        <MetadataSection items={buildMetadataItems(detail)} title="Cloud task" />
                        <MetadataSection items={buildStatsItems(detail)} title="Transcript stats" />
                    </div>
                </TabsContent>

                <TabsContent value="diff">
                    <DiffPanel detail={detail} />
                </TabsContent>

                <TabsContent value="raw">
                    <JsonPanel title="Allow-listed Cloud payload" value={detail.safeJson} />
                </TabsContent>
            </Tabs>

            <ExportDialog
                errorMessage={getMutationErrorMessage(exportMutation.error, 'Cloud task export failed')}
                open={exportOpen}
                pending={exportMutation.isPending}
                title={`Export ${detail.task.title}`}
                onExport={(options, callbacks) => exportMutation.mutate({ ...options, ...callbacks })}
                onOpenChange={(open) => {
                    setExportOpen(open);
                    if (!open) {
                        exportMutation.reset();
                    }
                }}
            />
        </div>
    );
}
