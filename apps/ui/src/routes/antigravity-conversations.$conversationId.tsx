import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Download, ScrollText, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AntigravityKeychainPanel } from '#/components/antigravity-keychain-panel';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { JsonPanel } from '#/components/json-panel';
import { LoadingPanel } from '#/components/loading-panel';
import { MetadataSection } from '#/components/metadata-section';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { TextDocumentPanel } from '#/components/text-document-panel';
import { TranscriptView } from '#/components/transcript-view';
import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { canExportAntigravityConversation } from '#/lib/antigravity-conversation-state';
import {
    antigravityConversationDetailQueryOptions,
    antigravityDecryptionQueryOptions,
} from '#/lib/antigravity-queries';
import {
    deleteAntigravityConversationFn,
    exportAntigravityArtifactsFn,
    exportAntigravityConversationFn,
    type getAntigravityConversationDetailFn,
} from '#/lib/antigravity-server';
import {
    antigravityMarkdownToThreadEvents,
    getAntigravityThreadTranscriptStats,
} from '#/lib/antigravity-transcript-events';
import { downloadTextFile } from '#/lib/download';
import { formatBytes, formatDateTime, formatNumber } from '#/lib/formatters';

type AntigravityConversationDetail = Awaited<ReturnType<typeof getAntigravityConversationDetailFn>>;

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

const buildConversationMetadata = (detail: AntigravityConversationDetail) => {
    return [
        { label: 'Conversation ID', value: <span data-mono="true">{detail.conversation.conversationId}</span> },
        {
            label: 'Workspace',
            value: (
                <Link
                    className="text-[var(--accent)]"
                    params={{ workspaceKey: detail.conversation.workspaceKey }}
                    to="/antigravity/$workspaceKey"
                >
                    {detail.conversation.workspaceLabel}
                </Link>
            ),
        },
        {
            label: 'Created',
            value: <span suppressHydrationWarning>{formatDateTime(detail.conversation.createdAtMs)}</span>,
        },
        {
            label: 'Updated',
            value: <span suppressHydrationWarning>{formatDateTime(detail.conversation.lastUpdatedAtMs)}</span>,
        },
        { label: 'Transcript source', value: detail.conversation.transcriptSource ?? 'n/a' },
        { label: 'Conversation path', value: detail.conversation.conversationPath ?? 'n/a' },
        { label: 'Transcript path', value: detail.conversation.transcriptPath ?? 'n/a' },
        { label: 'Summary path', value: detail.conversation.summaryPath ?? 'n/a' },
        { label: 'Source root', value: detail.conversation.sourceRoot ?? 'n/a' },
    ];
};

const buildTranscriptStatsItems = (
    detail: AntigravityConversationDetail,
    events: ReturnType<typeof antigravityMarkdownToThreadEvents>,
) => {
    if (detail.transcriptLocked) {
        return [
            { label: 'Transcript load', value: 'Transcript is locked until Antigravity Keychain access is enabled.' },
        ];
    }

    if (!detail.conversationMarkdown) {
        return [{ label: 'Transcript load', value: 'No renderable transcript content was found.' }];
    }

    const stats = getAntigravityThreadTranscriptStats(events);
    return [
        { label: 'Event kinds', value: [...new Set(events.map((event) => event.kind))].join(', ') || 'n/a' },
        { label: 'Messages', value: formatNumber(stats.messageCount) },
        { label: 'User messages', value: formatNumber(stats.userMessageCount) },
        { label: 'Assistant messages', value: formatNumber(stats.assistantMessageCount) },
        { label: 'Commentary updates', value: formatNumber(stats.commentaryCount) },
        { label: 'Final answers', value: formatNumber(stats.finalAnswerCount) },
        { label: 'Tool calls', value: formatNumber(stats.toolCallCount) },
        { label: 'Tool outputs', value: formatNumber(stats.toolOutputCount) },
    ];
};

export const Route = createFileRoute('/antigravity-conversations/$conversationId')({
    component: AntigravityConversationDetailPage,
    errorComponent: AntigravityConversationDetailErrorComponent,
    loader: async ({ context, params }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(antigravityDecryptionQueryOptions()),
            context.queryClient.ensureQueryData(antigravityConversationDetailQueryOptions(params.conversationId)),
        ]);
    },
    pendingComponent: () => (
        <LoadingPanel
            description="Loading the Antigravity conversation transcript, artifact data, and workspace context."
            title="Loading conversation"
        />
    ),
});

function AntigravityConversationDetailErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Antigravity conversation" />;
}

function AntigravityConversationHeaderActions({
    canExportArtifacts,
    canExportConversation,
    exportArtifactsPending,
    exportConversationPending,
    showConversationExport,
    onDeleteConversation,
    onExportArtifacts,
    onExportConversation,
}: {
    canExportArtifacts: boolean;
    canExportConversation: boolean;
    exportArtifactsPending: boolean;
    exportConversationPending: boolean;
    showConversationExport: boolean;
    onDeleteConversation: () => void;
    onExportArtifacts: () => void;
    onExportConversation: () => void;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {showConversationExport ? (
                <Button
                    className="rounded-full"
                    disabled={!canExportConversation || exportConversationPending}
                    type="button"
                    variant="outline"
                    onClick={onExportConversation}
                >
                    <Download className="mr-2 size-4" />
                    Export conversation
                </Button>
            ) : null}
            {canExportArtifacts ? (
                <Button
                    className="rounded-full"
                    disabled={exportArtifactsPending}
                    type="button"
                    variant="outline"
                    onClick={onExportArtifacts}
                >
                    <ScrollText className="mr-2 size-4" />
                    Export artifacts
                </Button>
            ) : null}
            <Button
                className="rounded-full border-[var(--destructive)]/20 text-[var(--destructive)]"
                type="button"
                variant="outline"
                onClick={onDeleteConversation}
            >
                <Trash2 className="mr-2 size-4" />
                Delete
            </Button>
        </div>
    );
}

const AntigravityTranscriptControls = ({
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
                    id="antigravity-transcript-show-tool-calls"
                    onCheckedChange={(checked) => onShowToolCallsChange(checked === true)}
                />
                <label htmlFor="antigravity-transcript-show-tool-calls">Show tool calls</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showCommentary}
                    id="antigravity-transcript-show-commentary"
                    onCheckedChange={(checked) => onShowCommentaryChange(checked === true)}
                />
                <label htmlFor="antigravity-transcript-show-commentary">Show commentary</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showExtraEvents}
                    id="antigravity-transcript-show-extra-events"
                    onCheckedChange={(checked) => onShowExtraEventsChange(checked === true)}
                />
                <label htmlFor="antigravity-transcript-show-extra-events">Show extra events</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showRawJson}
                    disabled={rawJsonDisabled}
                    id="antigravity-transcript-show-raw-json"
                    onCheckedChange={(checked) => onShowRawJsonChange(checked === true)}
                />
                <label htmlFor="antigravity-transcript-show-raw-json">Raw JSON</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={showUserMessages}
                    id="antigravity-transcript-show-user-messages"
                    onCheckedChange={(checked) => onShowUserMessagesChange(checked === true)}
                />
                <label htmlFor="antigravity-transcript-show-user-messages">User</label>
            </div>
        </div>
    );
};

function EmptyAntigravityTranscript({ detail }: { detail: AntigravityConversationDetail }) {
    return (
        <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
            <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                Transcript
            </h3>
            <p className="mt-4 text-[var(--muted-foreground)] text-sm">
                {detail.transcriptLocked
                    ? 'Unlock Antigravity transcript export to inspect the rendered conversation content here.'
                    : detail.artifactsMarkdown
                      ? 'No transcript preview is available for this conversation. Generated artifacts are available in the Raw tab.'
                      : 'No transcript preview is available for this conversation.'}
            </p>
        </section>
    );
}

function AntigravityRawPanels({
    detail,
    events,
}: {
    detail: AntigravityConversationDetail;
    events: ReturnType<typeof antigravityMarkdownToThreadEvents>;
}) {
    return (
        <div className="space-y-4">
            <JsonPanel title="Conversation summary" value={detail.conversation} />
            <JsonPanel title="Transcript events" value={events} />
            {detail.conversationMarkdown ? (
                <TextDocumentPanel
                    content={detail.conversationMarkdown}
                    description="Rendered transcript Markdown used for export."
                    title="Transcript Markdown"
                />
            ) : null}
            {detail.artifactsMarkdown ? (
                <TextDocumentPanel
                    content={detail.artifactsMarkdown}
                    description="Generated artifacts."
                    title="Artifacts"
                />
            ) : null}
        </div>
    );
}

function AntigravityConversationDetailPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const decryptionState = useSuspenseQuery(antigravityDecryptionQueryOptions()).data;
    const detail = useSuspenseQuery(antigravityConversationDetailQueryOptions(Route.useParams().conversationId)).data;
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [showCommentary, setShowCommentary] = useState(false);
    const [showExtraEvents, setShowExtraEvents] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);
    const [showUserMessages, setShowUserMessages] = useState(true);
    const transcriptEvents = useMemo(
        () => antigravityMarkdownToThreadEvents(detail.conversationMarkdown),
        [detail.conversationMarkdown],
    );
    const canExportConversation = canExportAntigravityConversation(
        detail.conversation,
        Boolean(decryptionState?.isUnlocked),
    );
    const canExportArtifacts = detail.artifactsMarkdown !== null;
    const showConversationExport = canExportConversation || detail.transcriptLocked;

    const exportConversationMutation = useMutation({
        mutationFn: () =>
            exportAntigravityConversationFn({ data: { conversationId: detail.conversation.conversationId } }),
        onSuccess: (result) => {
            downloadTextFile(result.filename, result.content, 'text/markdown; charset=utf-8');
        },
    });

    const exportArtifactsMutation = useMutation({
        mutationFn: () =>
            exportAntigravityArtifactsFn({ data: { conversationId: detail.conversation.conversationId } }),
        onSuccess: (result) => {
            downloadTextFile(result.filename, result.content, 'text/markdown; charset=utf-8');
        },
    });

    const deleteConversationMutation = useMutation({
        mutationFn: () =>
            deleteAntigravityConversationFn({ data: { conversationId: detail.conversation.conversationId } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['antigravity-workspaces'] }),
                queryClient.invalidateQueries({
                    queryKey: ['antigravity-conversations', detail.conversation.workspaceKey],
                }),
                queryClient.invalidateQueries({
                    queryKey: ['antigravity-conversation', detail.conversation.conversationId],
                }),
            ]);
            navigate({
                params: { workspaceKey: detail.conversation.workspaceKey },
                to: '/antigravity/$workspaceKey',
            });
        },
    });

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <AntigravityConversationHeaderActions
                        canExportArtifacts={canExportArtifacts}
                        canExportConversation={canExportConversation}
                        exportArtifactsPending={exportArtifactsMutation.isPending}
                        exportConversationPending={exportConversationMutation.isPending}
                        showConversationExport={showConversationExport}
                        onDeleteConversation={() => setDeleteOpen(true)}
                        onExportArtifacts={() => exportArtifactsMutation.mutate()}
                        onExportConversation={() => exportConversationMutation.mutate()}
                    />
                }
                breadcrumb={
                    <Breadcrumbs
                        items={[
                            { label: 'Antigravity', to: '/antigravity' },
                            {
                                label: detail.conversation.workspaceLabel,
                                params: { workspaceKey: detail.conversation.workspaceKey },
                                to: '/antigravity/$workspaceKey',
                            },
                            { label: detail.conversation.title },
                        ]}
                    />
                }
                eyebrow="Antigravity conversation"
                subtitle="Conversation detail for the selected Antigravity workspace session."
                title={detail.conversation.title}
            />

            <AntigravityKeychainPanel />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Transcript entries" value={formatNumber(detail.conversation.transcriptEntryCount)} />
                <MetricCard label="Artifacts" value={formatNumber(detail.conversation.artifactCount)} />
                <MetricCard label="Size" value={formatBytes(detail.conversation.conversationBytes)} />
                <MetricCard
                    helper={detail.conversation.transcriptSource ?? 'summary'}
                    label="Indexed items"
                    value={formatNumber(detail.conversation.indexedItemCount ?? 0)}
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
                    <AntigravityTranscriptControls
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
                            assistantModel={null}
                            events={transcriptEvents}
                            projectPath={detail.conversation.workspaceFolder}
                            showCommentary={showCommentary}
                            showExtraEvents={showExtraEvents}
                            showRawJson={showRawJson}
                            showToolCalls={showToolCalls}
                            showUserMessages={showUserMessages}
                        />
                    ) : (
                        <EmptyAntigravityTranscript detail={detail} />
                    )}
                </TabsContent>

                <TabsContent value="metadata">
                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                        <MetadataSection items={buildConversationMetadata(detail)} title="Conversation metadata" />
                        <MetadataSection
                            items={buildTranscriptStatsItems(detail, transcriptEvents)}
                            title="Transcript stats"
                        />
                    </div>
                </TabsContent>

                <TabsContent value="raw">
                    <AntigravityRawPanels detail={detail} events={transcriptEvents} />
                </TabsContent>
            </Tabs>

            {exportConversationMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {exportConversationMutation.error instanceof Error
                        ? exportConversationMutation.error.message
                        : 'Conversation export failed'}
                </p>
            ) : null}

            {exportArtifactsMutation.isError ? (
                <p className="text-[var(--destructive)] text-sm">
                    {exportArtifactsMutation.error instanceof Error
                        ? exportArtifactsMutation.error.message
                        : 'Artifact export failed'}
                </p>
            ) : null}

            <DeleteConfirmDialog
                confirmLabel={deleteConversationMutation.isPending ? 'Deleting...' : 'Delete conversation'}
                description="Permanently delete this Antigravity conversation from disk. This removes its summary entry, conversation file, transcript logs, and generated artifacts."
                errorMessage={
                    deleteConversationMutation.isError
                        ? deleteConversationMutation.error instanceof Error
                            ? deleteConversationMutation.error.message
                            : 'Conversation delete failed'
                        : null
                }
                open={deleteOpen}
                title="Delete this Antigravity conversation?"
                onConfirm={() => deleteConversationMutation.mutate()}
                onOpenChange={(open) => {
                    setDeleteOpen(open);
                    if (!open) {
                        deleteConversationMutation.reset();
                    }
                }}
            />
        </div>
    );
}
