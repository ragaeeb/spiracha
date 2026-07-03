import type { MessageEvent, ThreadEvent } from '@spiracha/lib/codex-browser-types';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, Download, Search, Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { JsonPanel } from '#/components/json-panel';
import { LoadingPanel } from '#/components/loading-panel';
import { MetadataSection } from '#/components/metadata-section';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { getTranscriptEventKey, shouldShowEvent, TranscriptView } from '#/components/transcript-view';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';
import { Input } from '#/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { threadSnapshotQueryOptions, threadTranscriptQueryOptions } from '#/lib/codex-queries';
import { deleteThreadFn, exportThreadFn, type getThreadSnapshotFn } from '#/lib/codex-server';
import { downloadTextFile, downloadUrlFile } from '#/lib/download';
import {
    formatBooleanLabel,
    formatBytes,
    formatDateTime,
    formatList,
    formatModelLabel,
    formatTokens,
} from '#/lib/formatters';
import { applyPathTransforms } from '#/lib/path-utils';
import { useSettings } from '#/lib/settings-store';

type ThreadSnapshot = Awaited<ReturnType<typeof getThreadSnapshotFn>>;

type TranscriptSearchResult = {
    event: MessageEvent;
    eventIndex: number;
    eventKey: string;
    messageNumber: number;
    phase: string | null;
    roleLabel: string;
    snippet: string;
};

type TranscriptSearchPanelProps = {
    activeResultIndex: number;
    query: string;
    results: TranscriptSearchResult[];
    onJumpToResult: (index: number) => void;
    onQueryChange: (value: string) => void;
};

type TranscriptSearchFilters = {
    showCommentary: boolean;
    showExtraEvents: boolean;
    showToolCalls: boolean;
    showUserMessages: boolean;
};

const SEARCH_SNIPPET_RADIUS = 72;

const normalizeTranscriptSearchText = (value: string) => value.replace(/\s+/gu, ' ').trim();

const getTranscriptSearchRoleLabel = (event: MessageEvent, assistantModel: string | null) => {
    if (event.role === 'assistant') {
        return formatModelLabel(event.model ?? assistantModel);
    }

    return event.role === 'system' ? 'System' : 'User';
};

const buildTranscriptSearchSnippet = (text: string, query: string) => {
    const normalizedText = normalizeTranscriptSearchText(text);
    const normalizedQuery = normalizeTranscriptSearchText(query).toLowerCase();
    const matchIndex = normalizedText.toLowerCase().indexOf(normalizedQuery);

    if (matchIndex < 0) {
        return normalizedText.slice(0, SEARCH_SNIPPET_RADIUS * 2);
    }

    const start = Math.max(0, matchIndex - SEARCH_SNIPPET_RADIUS);
    const end = Math.min(normalizedText.length, matchIndex + normalizedQuery.length + SEARCH_SNIPPET_RADIUS);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < normalizedText.length ? '...' : '';

    return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
};

const buildTranscriptSearchResults = (
    events: ThreadEvent[],
    query: string,
    assistantModel: string | null,
    filters: TranscriptSearchFilters,
    transform: (text: string) => string,
): TranscriptSearchResult[] => {
    const normalizedQuery = normalizeTranscriptSearchText(query).toLowerCase();
    if (!normalizedQuery) {
        return [];
    }

    const results: TranscriptSearchResult[] = [];
    let messageNumber = 0;

    events.forEach((event, index) => {
        if (event.kind !== 'message') {
            return;
        }

        if (
            !shouldShowEvent(
                event,
                filters.showToolCalls,
                filters.showExtraEvents,
                filters.showCommentary,
                filters.showUserMessages,
            )
        ) {
            return;
        }

        messageNumber += 1;
        const searchText = normalizeTranscriptSearchText(transform(event.text));
        if (!searchText.toLowerCase().includes(normalizedQuery)) {
            return;
        }

        results.push({
            event,
            eventIndex: index,
            eventKey: getTranscriptEventKey(event, index),
            messageNumber,
            phase: event.phase,
            roleLabel: getTranscriptSearchRoleLabel(event, assistantModel),
            snippet: buildTranscriptSearchSnippet(searchText, query),
        });
    });

    return results;
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

type ThreadMetadataProps = {
    snapshot: ThreadSnapshot;
};

const buildThreadItems = (snapshot: ThreadSnapshot) => {
    return [
        { label: 'Thread ID', value: <span data-mono="true">{snapshot.thread.id}</span> },
        { label: 'Project', value: snapshot.project },
        { label: 'CWD', value: <span data-mono="true">{snapshot.thread.cwd}</span> },
        {
            label: 'Created',
            value: (
                <span suppressHydrationWarning>
                    {formatDateTime(snapshot.thread.created_at_ms ?? snapshot.thread.created_at * 1000)}
                </span>
            ),
        },
        {
            label: 'Updated',
            value: (
                <span suppressHydrationWarning>
                    {formatDateTime(snapshot.thread.updated_at_ms ?? snapshot.thread.updated_at * 1000)}
                </span>
            ),
        },
        {
            label: 'Session started',
            value: (
                <span suppressHydrationWarning>
                    {formatDateTime(snapshot.transcript?.sessionMeta.timestamp ?? null)}
                </span>
            ),
        },
        { label: 'Rollout size', value: formatBytes(snapshot.rollout.fileSizeBytes) },
        { label: 'Archived', value: formatBooleanLabel(Boolean(snapshot.thread.archived)) },
        {
            label: 'Archived at',
            value: (
                <span suppressHydrationWarning>
                    {formatDateTime(snapshot.thread.archived_at ? snapshot.thread.archived_at * 1000 : null)}
                </span>
            ),
        },
    ];
};

const buildRuntimeItems = (snapshot: ThreadSnapshot) => {
    return [
        { label: 'Source', value: snapshot.thread.source },
        { label: 'Originator', value: snapshot.transcript?.sessionMeta.originator ?? 'n/a' },
        { label: 'Model provider', value: snapshot.thread.model_provider },
        { label: 'Reasoning effort', value: snapshot.thread.reasoning_effort ?? 'n/a' },
        { label: 'CLI version', value: snapshot.thread.cli_version },
        { label: 'Approval mode', value: snapshot.thread.approval_mode },
        { label: 'Memory mode', value: snapshot.thread.memory_mode },
        { label: 'Has user event', value: formatBooleanLabel(Boolean(snapshot.thread.has_user_event)) },
    ];
};

const buildGitItems = (snapshot: ThreadSnapshot) => {
    return [
        { label: 'Git branch', value: snapshot.thread.git_branch ?? 'n/a' },
        { label: 'Git SHA', value: snapshot.thread.git_sha ?? 'n/a' },
        { label: 'Git remote', value: snapshot.thread.git_origin_url ?? 'n/a' },
        { label: 'Agent nickname', value: snapshot.thread.agent_nickname ?? 'n/a' },
        { label: 'Agent role', value: snapshot.thread.agent_role ?? 'n/a' },
        { label: 'Agent path', value: snapshot.thread.agent_path ?? 'n/a' },
    ];
};

const buildRelationItems = (snapshot: ThreadSnapshot) => {
    const parentThreadValue = snapshot.relations.parentThreadId ? (
        <Link
            className="text-[var(--accent)]"
            params={{ threadId: snapshot.relations.parentThreadId }}
            to="/threads/$threadId"
        >
            {snapshot.relations.parentThreadId}
        </Link>
    ) : (
        'n/a'
    );

    const childThreadValue =
        snapshot.relations.childEdges.length > 0 ? (
            <div className="flex flex-wrap gap-2">
                {snapshot.relations.childEdges.map((edge) => (
                    <Link
                        key={edge.child_thread_id}
                        className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--accent)] text-xs"
                        params={{ threadId: edge.child_thread_id }}
                        to="/threads/$threadId"
                    >
                        {edge.child_thread_id}
                    </Link>
                ))}
            </div>
        ) : (
            'n/a'
        );

    return [
        { label: 'Parent thread', value: parentThreadValue },
        { label: 'Child threads', value: childThreadValue },
        { label: 'First user message', value: snapshot.thread.first_user_message || 'n/a' },
        { label: 'Preview', value: snapshot.thread.preview || 'n/a' },
    ];
};

const buildTranscriptStatsItems = (snapshot: ThreadSnapshot) => {
    if (!snapshot.transcript) {
        if (snapshot.transcriptState === 'missing') {
            return [
                { label: 'Transcript load', value: 'Transcript file missing from disk' },
                { label: 'Rollout path', value: snapshot.thread.rollout_path },
                {
                    label: 'Preview mode',
                    value: 'Export and transcript browsing are unavailable until the file exists again.',
                },
            ];
        }

        return [
            { label: 'Transcript load', value: 'Deferred for oversized rollout' },
            { label: 'Rollout size', value: formatBytes(snapshot.rollout.fileSizeBytes) },
            { label: 'Deferred load', value: 'Load the transcript manually to inspect it.' },
        ];
    }

    return [
        {
            label: 'Event kinds',
            value: formatList([...new Set(snapshot.transcript.events.map((event) => event.kind))]),
        },
        { label: 'Stats scope', value: snapshot.transcript.statsArePartial ? 'Preview only' : 'Full transcript' },
        { label: 'Tool calls', value: String(snapshot.transcript.stats.toolCallCount) },
        { label: 'Exec calls', value: String(snapshot.transcript.stats.execCommandCount) },
        { label: 'Web search events', value: String(snapshot.transcript.stats.webSearchEventCount) },
        { label: 'Assistant messages', value: String(snapshot.transcript.stats.assistantMessageCount) },
        { label: 'Commentary updates', value: String(snapshot.transcript.stats.commentaryCount) },
    ];
};

function TranscriptControls({
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
}: TranscriptControlsProps) {
    return (
        <div className="flex flex-wrap gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-[var(--panel-shadow)]">
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showToolCalls}
                    id="transcript-show-tool-calls"
                    onCheckedChange={(checked) => onShowToolCallsChange(checked === true)}
                />
                <label htmlFor="transcript-show-tool-calls">Show tool calls</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showCommentary}
                    id="transcript-show-commentary"
                    onCheckedChange={(checked) => onShowCommentaryChange(checked === true)}
                />
                <label htmlFor="transcript-show-commentary">Show commentary</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showExtraEvents}
                    id="transcript-show-extra-events"
                    onCheckedChange={(checked) => onShowExtraEventsChange(checked === true)}
                />
                <label htmlFor="transcript-show-extra-events">Show extra events</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showRawJson}
                    disabled={rawJsonDisabled}
                    id="transcript-show-raw-json"
                    onCheckedChange={(checked) => onShowRawJsonChange(checked === true)}
                />
                <label htmlFor="transcript-show-raw-json">Raw JSON</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showUserMessages}
                    id="transcript-show-user-messages"
                    onCheckedChange={(checked) => onShowUserMessagesChange(checked === true)}
                />
                <label htmlFor="transcript-show-user-messages">User</label>
            </div>
        </div>
    );
}

function TranscriptSearchPanel({
    activeResultIndex,
    query,
    results,
    onJumpToResult,
    onQueryChange,
}: TranscriptSearchPanelProps) {
    const hasQuery = normalizeTranscriptSearchText(query).length > 0;
    const hasResults = results.length > 0;
    const statusLabel = hasQuery
        ? hasResults
            ? `${activeResultIndex + 1} / ${results.length}`
            : 'No matches'
        : 'Search';

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || !hasResults) {
            return;
        }

        event.preventDefault();
        onJumpToResult(event.shiftKey ? activeResultIndex - 1 : activeResultIndex);
    };

    return (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-[var(--panel-shadow)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                    <Input
                        aria-label="Search transcript messages"
                        className="h-10 rounded-full border-[var(--border)] bg-[var(--panel-secondary)] pr-4 pl-9"
                        placeholder="Search transcript messages"
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-20 text-right text-[var(--muted-foreground)] text-sm">{statusLabel}</span>
                    <Button
                        className="rounded-full"
                        disabled={!hasResults}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => onJumpToResult(activeResultIndex - 1)}
                    >
                        <ChevronUp className="size-4" />
                        Prev
                    </Button>
                    <Button
                        className="rounded-full"
                        disabled={!hasResults}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => onJumpToResult(activeResultIndex + 1)}
                    >
                        <ChevronDown className="size-4" />
                        Next
                    </Button>
                </div>
            </div>

            {hasQuery && hasResults ? (
                <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)]">
                    {results.map((result, index) => (
                        <button
                            key={result.eventKey}
                            aria-current={index === activeResultIndex ? 'true' : undefined}
                            className="block w-full border-[var(--border)] border-b px-3 py-2.5 text-left transition last:border-b-0 hover:bg-[var(--panel)] aria-current:bg-[var(--panel)]"
                            type="button"
                            onClick={() => onJumpToResult(index)}
                        >
                            <span className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-sm">Message {result.messageNumber}</span>
                                <Badge variant="outline">{result.roleLabel}</Badge>
                                {result.phase ? <Badge variant="outline">{result.phase}</Badge> : null}
                            </span>
                            <span className="mt-1 block min-w-0 break-words text-[var(--muted-foreground)] text-sm leading-5 [overflow-wrap:anywhere]">
                                {result.snippet}
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}
        </section>
    );
}

function ThreadMetadataPanels({ snapshot }: ThreadMetadataProps) {
    return (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
                <MetadataSection items={buildThreadItems(snapshot)} title="Thread" />
                <MetadataSection items={buildRuntimeItems(snapshot)} title="Runtime" />
                <MetadataSection items={buildGitItems(snapshot)} title="Git and agent" />
            </div>

            <div className="space-y-4">
                <MetadataSection items={buildRelationItems(snapshot)} title="Relations and summary" />

                <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                    <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                        Available tools
                    </h3>
                    <div className="mt-4 space-y-3">
                        {snapshot.availableTools.map((tool) => (
                            <div
                                key={`${tool.name}-${tool.namespace ?? 'global'}`}
                                className="rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3.5"
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium font-mono text-sm">{tool.name}</p>
                                    {tool.namespace ? <Badge variant="outline">{tool.namespace}</Badge> : null}
                                </div>
                                <p className="mt-1.5 text-[var(--muted-foreground)] text-sm">
                                    {tool.description || 'No description.'}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                <MetadataSection items={buildTranscriptStatsItems(snapshot)} title="Transcript stats" />
            </div>
        </div>
    );
}

function ThreadRawPanels({ snapshot }: ThreadMetadataProps) {
    if (!snapshot.transcript) {
        return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-5 py-4 text-sm">
                {snapshot.transcriptState === 'missing'
                    ? 'The rollout JSONL file is missing from disk, so raw transcript payloads are unavailable.'
                    : 'Raw transcript payloads are deferred for oversized rollouts. Use Export if you only need the full thread contents, or load the transcript manually from the Transcript tab.'}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <JsonPanel title="Session meta" value={snapshot.transcript.sessionMeta} />
            <JsonPanel title="Turn contexts" value={snapshot.transcript.turnContexts} />
            <JsonPanel title="Sandbox policy" value={snapshot.thread.sandbox_policy} />
        </div>
    );
}

function DeferredTranscriptNotice({
    fileSizeBytes,
    missing,
    pending,
    onLoad,
}: {
    fileSizeBytes: number | null;
    missing?: boolean;
    pending: boolean;
    onLoad: () => void;
}) {
    return (
        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-base">
                {missing ? 'Transcript file missing' : 'This is a very big thread'}
            </h3>
            <p className="mt-2 text-[var(--muted-foreground)] text-sm leading-6">
                {missing
                    ? 'The rollout JSONL referenced by this thread is no longer present on disk. Export may still work if the file is restored, but transcript browsing is unavailable right now.'
                    : `Spiracha skipped loading the transcript automatically because the rollout file is ${formatBytes(fileSizeBytes)}. Export still works immediately. Load the full transcript when you need to inspect it here.`}
            </p>
            {missing ? null : (
                <div className="mt-4">
                    <Button disabled={pending} variant="outline" onClick={onLoad}>
                        {pending ? 'Loading transcript...' : 'Load full transcript'}
                    </Button>
                </div>
            )}
        </section>
    );
}

function ThreadErrorComponent({ error }: { error: Error }) {
    const isSqlite = error.message.includes('unable to open database') || error.message.includes('database is locked');
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-6 py-10 text-center">
            <p className="font-medium text-[var(--destructive)] text-sm">
                {isSqlite ? 'Database unavailable' : 'Failed to load thread'}
            </p>
            <p className="mt-2 text-[var(--muted-foreground)] text-sm">
                {isSqlite ? 'Codex may have an exclusive lock on the database. Reload to retry.' : error.message}
            </p>
            <button
                className="mt-4 text-[var(--accent)] text-sm underline-offset-2 hover:underline"
                type="button"
                onClick={() => window.location.reload()}
            >
                Reload
            </button>
        </div>
    );
}

const getThreadExportErrorMessage = (transcriptMissing: boolean, error: unknown): string | null => {
    if (transcriptMissing) {
        return 'The rollout JSONL file is missing from disk, so this thread cannot be exported right now.';
    }

    return error instanceof Error ? error.message : null;
};

export const Route = createFileRoute('/threads/$threadId')({
    component: ThreadDetailPage,
    errorComponent: ThreadErrorComponent,
    loader: ({ context, params }) => context.queryClient.ensureQueryData(threadSnapshotQueryOptions(params.threadId)),
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the transcript, metadata, and parsed event stream for this thread."
            title="Loading thread"
        />
    ),
});

function ThreadDetailPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const params = Route.useParams();
    const snapshot = useSuspenseQuery(threadSnapshotQueryOptions(params.threadId)).data;
    const { settings } = useSettings();
    const transcriptMissing = snapshot.transcriptState === 'missing';
    const [shouldLoadTranscript, setShouldLoadTranscript] = useState(
        !snapshot.rollout.shouldDeferTranscriptLoad && !transcriptMissing,
    );
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(false);
    const [transcriptSearchInput, setTranscriptSearchInput] = useState('');
    const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(0);
    const [activeTranscriptEventKey, setActiveTranscriptEventKey] = useState<string | null>(null);
    const [activeEventJumpSignal, setActiveEventJumpSignal] = useState(0);
    const [exportOpen, setExportOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const transcriptQuery = useQuery({
        ...threadTranscriptQueryOptions(params.threadId),
        enabled: shouldLoadTranscript && snapshot.transcript === null && !transcriptMissing,
    });
    const transcript = snapshot.transcript ?? transcriptQuery.data ?? null;
    const viewSnapshot = { ...snapshot, transcript };
    const transcriptSearchResults = useMemo(
        () =>
            transcript
                ? buildTranscriptSearchResults(
                      transcript.events,
                      transcriptSearchInput,
                      snapshot.thread.model,
                      {
                          showCommentary,
                          showExtraEvents,
                          showToolCalls,
                          showUserMessages,
                      },
                      (text) => applyPathTransforms(text, settings, snapshot.thread.cwd),
                  )
                : [],
        [
            transcript,
            transcriptSearchInput,
            snapshot.thread.model,
            showCommentary,
            showExtraEvents,
            showToolCalls,
            showUserMessages,
            snapshot.thread.cwd,
            settings,
        ],
    );

    useEffect(() => {
        setActiveSearchResultIndex((current) =>
            transcriptSearchResults.length === 0 ? 0 : Math.min(current, transcriptSearchResults.length - 1),
        );
        setActiveTranscriptEventKey((current) =>
            current && transcriptSearchResults.some((result) => result.eventKey === current) ? current : null,
        );
    }, [transcriptSearchResults]);

    const updateTranscriptSearchInput = (value: string) => {
        setTranscriptSearchInput(value);
        setActiveSearchResultIndex(0);
        setActiveTranscriptEventKey(null);
    };

    const jumpToTranscriptSearchResult = (index: number) => {
        if (transcriptSearchResults.length === 0) {
            return;
        }

        const wrappedIndex =
            ((index % transcriptSearchResults.length) + transcriptSearchResults.length) %
            transcriptSearchResults.length;
        const result = transcriptSearchResults[wrappedIndex]!;

        setActiveSearchResultIndex(wrappedIndex);
        setActiveTranscriptEventKey(result.eventKey);
        setActiveEventJumpSignal((current) => current + 1);
    };

    const exportThreadMutation = useMutation({
        mutationFn: async (options: {
            includeCommentary: boolean;
            includeTools: boolean;
            includeMetadata: boolean;
            outputFormat: 'md' | 'txt';
            zipArchive: boolean;
        }) => {
            console.info('[spiracha:export-ui] request', {
                outputFormat: options.outputFormat,
                project: snapshot.project,
                selectedThreadCount: 1,
                selectedThreadIds: [snapshot.thread.id],
                zipArchive: options.zipArchive,
            });

            const download = await exportThreadFn({
                data: {
                    ...options,
                    ...settings,
                    threadId: snapshot.thread.id,
                },
            });

            console.info('[spiracha:export-ui] response', {
                downloadUrl: download.mode === 'download_url' ? download.downloadUrl : null,
                fileName: download.fileName,
                mode: download.mode,
                project: snapshot.project,
                selectedThreadCount: 1,
            });

            if (download.mode === 'download') {
                downloadTextFile(download.fileName, download.content, download.mimeType);
                return;
            }

            await downloadUrlFile(download.fileName, download.downloadUrl);
        },
        onError: (error) => {
            console.error('[spiracha:export-ui] failed', {
                error: error instanceof Error ? error.message : String(error),
                project: snapshot.project,
                selectedThreadCount: 1,
                selectedThreadIds: [snapshot.thread.id],
            });
        },
        onSuccess: async () => {
            setExportOpen(false);
        },
    });

    const deleteThreadMutation = useMutation({
        mutationFn: (input: { deleteSessionFiles: boolean }) =>
            deleteThreadFn({
                data: {
                    deleteSessionFiles: input.deleteSessionFiles,
                    threadId: snapshot.thread.id,
                },
            }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['analytics'] }),
                queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
                queryClient.invalidateQueries({ queryKey: ['project-threads', snapshot.project] }),
                queryClient.invalidateQueries({ queryKey: ['projects'] }),
            ]);

            navigate({
                params: {
                    project: snapshot.project,
                },
                to: '/codex/$project',
            });
        },
    });

    return (
        <div className="space-y-5">
            <PageHeader
                actions={
                    <>
                        <Button className="rounded-full" variant="outline" onClick={() => setExportOpen(true)}>
                            <Download className="mr-2 size-4" />
                            Export
                        </Button>
                        <Button
                            className="rounded-full border-[var(--destructive)]/20 text-[var(--destructive)]"
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
                            { label: 'Codex', to: '/codex' },
                            {
                                label: snapshot.project,
                                params: { project: snapshot.project },
                                to: '/codex/$project',
                            },
                            { label: snapshot.thread.title, title: snapshot.thread.title, truncate: true },
                        ]}
                    />
                }
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Model" value={snapshot.thread.model ?? 'unknown'} />
                <MetricCard label="Tokens" value={formatTokens(snapshot.thread.tokens_used)} />
                <MetricCard
                    label="Updated"
                    value={
                        <span suppressHydrationWarning>
                            {formatDateTime(snapshot.thread.updated_at_ms ?? snapshot.thread.updated_at * 1000)}
                        </span>
                    }
                />
                <MetricCard
                    label="Thread source"
                    value={snapshot.thread.thread_source ?? transcript?.sessionMeta.threadSource ?? 'n/a'}
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
                    <TranscriptControls
                        rawJsonDisabled={!transcript?.rawIncluded}
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
                    {transcript ? (
                        <TranscriptSearchPanel
                            activeResultIndex={activeSearchResultIndex}
                            query={transcriptSearchInput}
                            results={transcriptSearchResults}
                            onJumpToResult={jumpToTranscriptSearchResult}
                            onQueryChange={updateTranscriptSearchInput}
                        />
                    ) : null}
                    {transcript ? (
                        <TranscriptView
                            activeEventJumpSignal={activeEventJumpSignal}
                            activeEventKey={activeTranscriptEventKey}
                            assistantModel={snapshot.thread.model}
                            events={transcript.events}
                            projectPath={snapshot.thread.cwd}
                            showCommentary={showCommentary}
                            showExtraEvents={showExtraEvents}
                            showRawJson={showRawJson && transcript.rawIncluded}
                            showToolCalls={showToolCalls}
                            showUserMessages={showUserMessages}
                        />
                    ) : (
                        <DeferredTranscriptNotice
                            fileSizeBytes={snapshot.rollout.fileSizeBytes}
                            missing={snapshot.transcriptState === 'missing'}
                            pending={transcriptQuery.isFetching}
                            onLoad={() => setShouldLoadTranscript(true)}
                        />
                    )}
                    {transcriptQuery.isError ? (
                        <p className="text-[var(--destructive)] text-sm">
                            Failed to load transcript preview:{' '}
                            {transcriptQuery.error instanceof Error ? transcriptQuery.error.message : 'Unknown error'}
                        </p>
                    ) : null}
                </TabsContent>

                <TabsContent value="metadata">
                    <ThreadMetadataPanels snapshot={viewSnapshot} />
                </TabsContent>

                <TabsContent value="raw">
                    <ThreadRawPanels snapshot={viewSnapshot} />
                </TabsContent>
            </Tabs>

            <DeleteConfirmDialog
                confirmLabel={deleteThreadMutation.isPending ? 'Deleting...' : 'Delete thread'}
                defaultDeleteSessionFiles
                description="Delete this thread from the Codex database. Enable Delete Session files if you also want to remove the rollout JSONL from disk."
                open={deleteOpen}
                showDeleteSessionFilesOption
                title="Delete this thread from Codex DB?"
                onConfirm={({ deleteSessionFiles }) => deleteThreadMutation.mutate({ deleteSessionFiles })}
                onOpenChange={setDeleteOpen}
            />

            <ExportDialog
                disabled={transcriptMissing}
                errorMessage={getThreadExportErrorMessage(transcriptMissing, exportThreadMutation.error)}
                open={exportOpen}
                pending={exportThreadMutation.isPending}
                onExport={(options) => {
                    if (!transcriptMissing) {
                        exportThreadMutation.mutate(options);
                    }
                }}
                onOpenChange={setExportOpen}
            />
        </div>
    );
}
