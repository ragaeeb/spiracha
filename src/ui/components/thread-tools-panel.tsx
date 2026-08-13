import type { DynamicToolDefinition, ThreadEvent } from '@spiracha/lib/codex-browser-types';
import { type TranscriptSortOrder, TranscriptView } from '#/components/transcript-view';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';

type ThreadToolsPanelProps = {
    assistantModel: string | null;
    availableTools: DynamicToolDefinition[];
    events: ThreadEvent[] | null;
    loadingTranscript?: boolean;
    projectPath: string | null;
    showRawJson: boolean;
    sortOrder: TranscriptSortOrder;
    transcriptIsPartial?: boolean;
    transcriptState: 'available' | 'deferred' | 'missing';
    onLoadTranscript?: () => void;
    onSortOrderChange?: (value: TranscriptSortOrder) => void;
};

const getToolActivityEvents = (events: ThreadEvent[]) =>
    events.filter((event) => event.kind === 'tool_call' || event.kind === 'tool_output' || event.kind === 'web_search');

const sortJsonKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(sortJsonKeys);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, sortJsonKeys(child)]),
        );
    }
    return value;
};

const getToolDefinitionKey = (tool: DynamicToolDefinition) =>
    JSON.stringify([tool.namespace, tool.name, tool.description, tool.deferLoading, sortJsonKeys(tool.inputSchema)]);

const ToolDefinitions = ({ tools }: { tools: DynamicToolDefinition[] }) => {
    const uniqueTools = [...new Map(tools.map((tool) => [getToolDefinitionKey(tool), tool])).entries()];

    return (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-[0.18em]">
                Available tools
            </h3>
            {uniqueTools.length === 0 ? (
                <p className="mt-3 text-[var(--muted-foreground)] text-sm">
                    No dynamic tool definitions were recorded for this thread.
                </p>
            ) : (
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    {uniqueTools.map(([toolKey, tool]) => (
                        <article
                            key={toolKey}
                            className="rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)] p-3.5"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium font-mono text-sm">{tool.name}</p>
                                {tool.namespace ? <Badge variant="outline">{tool.namespace}</Badge> : null}
                                {tool.deferLoading ? <Badge variant="outline">deferred</Badge> : null}
                            </div>
                            <p className="mt-1.5 text-[var(--muted-foreground)] text-sm">
                                {tool.description || 'No description.'}
                            </p>
                            {tool.inputSchema ? (
                                <details className="mt-3 text-xs">
                                    <summary className="cursor-pointer text-[var(--muted-foreground)]">
                                        Input schema
                                    </summary>
                                    <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--code-background)] p-3 text-[var(--code-foreground)] leading-5">
                                        {JSON.stringify(tool.inputSchema, null, 2)}
                                    </pre>
                                </details>
                            ) : null}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
};

export function ThreadToolsPanel({
    assistantModel,
    availableTools,
    events,
    loadingTranscript = false,
    projectPath,
    showRawJson,
    sortOrder,
    transcriptIsPartial = false,
    transcriptState,
    onLoadTranscript,
    onSortOrderChange,
}: ThreadToolsPanelProps) {
    const toolEvents = events ? getToolActivityEvents(events) : [];
    const canLoadMore = transcriptState === 'deferred' || transcriptIsPartial;

    return (
        <div className="space-y-3">
            <ToolDefinitions tools={availableTools} />
            <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--panel-shadow)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-[0.18em]">
                        Tool activity
                    </h3>
                    {canLoadMore && onLoadTranscript ? (
                        <Button disabled={loadingTranscript} size="sm" variant="outline" onClick={onLoadTranscript}>
                            {loadingTranscript ? 'Loading tool activity...' : 'Load tool activity'}
                        </Button>
                    ) : null}
                </div>
                {transcriptState === 'missing' ? (
                    <p className="text-[var(--muted-foreground)] text-sm">
                        The rollout file is missing, so recorded tool activity is unavailable.
                    </p>
                ) : toolEvents.length === 0 ? (
                    <p className="text-[var(--muted-foreground)] text-sm">
                        {canLoadMore
                            ? 'The current transcript preview has no tool activity. Load the full thread to inspect every call.'
                            : 'No tool calls, outputs, or web searches were recorded for this thread.'}
                    </p>
                ) : (
                    <TranscriptView
                        assistantModel={assistantModel}
                        events={toolEvents}
                        projectPath={projectPath}
                        showCommentary={false}
                        showExtraEvents
                        showRawJson={showRawJson}
                        showToolCalls
                        showUserMessages={false}
                        sortOrder={sortOrder}
                        onSortOrderChange={onSortOrderChange}
                    />
                )}
            </section>
        </div>
    );
}
