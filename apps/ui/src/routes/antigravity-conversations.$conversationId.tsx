import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Download, ScrollText } from 'lucide-react';
import { AntigravityKeychainPanel } from '#/components/antigravity-keychain-panel';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { LoadingPanel } from '#/components/loading-panel';
import { MetadataSection } from '#/components/metadata-section';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { TextDocumentPanel } from '#/components/text-document-panel';
import { Button } from '#/components/ui/button';
import {
    antigravityConversationDetailQueryOptions,
    antigravityDecryptionQueryOptions,
} from '#/lib/antigravity-queries';
import {
    exportAntigravityArtifactsFn,
    exportAntigravityConversationFn,
    type getAntigravityConversationDetailFn,
} from '#/lib/antigravity-server';
import { downloadTextFile } from '#/lib/download';
import { formatBytes, formatDateTime, formatNumber } from '#/lib/formatters';

type AntigravityConversationDetail = Awaited<ReturnType<typeof getAntigravityConversationDetailFn>>;

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
    detail,
    exportArtifactsPending,
    exportConversationPending,
    showConversationExport,
    onExportArtifacts,
    onExportConversation,
}: {
    detail: AntigravityConversationDetail;
    exportArtifactsPending: boolean;
    exportConversationPending: boolean;
    showConversationExport: boolean;
    onExportArtifacts: () => void;
    onExportConversation: () => void;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {showConversationExport ? (
                <Button
                    className="rounded-full"
                    disabled={detail.transcriptLocked || exportConversationPending}
                    type="button"
                    variant="outline"
                    onClick={onExportConversation}
                >
                    <Download className="mr-2 size-4" />
                    Export conversation
                </Button>
            ) : null}
            {detail.conversation.artifactCount > 0 ? (
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
        </div>
    );
}

function AntigravityConversationPanels({ detail }: { detail: AntigravityConversationDetail }) {
    return (
        <div className="space-y-4">
            {detail.transcriptLocked ? (
                <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                    <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                        Transcript
                    </h3>
                    <p className="mt-4 text-[var(--muted-foreground)] text-sm">
                        Unlock Antigravity transcript export to inspect the rendered conversation content here.
                    </p>
                </section>
            ) : detail.conversationMarkdown ? (
                <TextDocumentPanel
                    content={detail.conversationMarkdown}
                    description="Rendered from the available Antigravity transcript or decrypted safe-storage payload."
                    title="Conversation transcript"
                />
            ) : (
                <section className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--panel-shadow)]">
                    <h3 className="font-semibold text-[var(--muted-foreground)] text-sm uppercase tracking-[0.18em]">
                        Transcript
                    </h3>
                    <p className="mt-4 text-[var(--muted-foreground)] text-sm">
                        {detail.artifactsMarkdown
                            ? 'No transcript preview is available for this conversation. Generated artifacts are available below.'
                            : 'No transcript preview is available for this conversation.'}
                    </p>
                </section>
            )}

            {detail.artifactsMarkdown ? (
                <TextDocumentPanel
                    content={detail.artifactsMarkdown}
                    description="Markdown artifacts generated for this conversation."
                    title="Artifacts"
                />
            ) : null}
        </div>
    );
}

function AntigravityConversationDetailPage() {
    useSuspenseQuery(antigravityDecryptionQueryOptions());
    const detail = useSuspenseQuery(antigravityConversationDetailQueryOptions(Route.useParams().conversationId)).data;
    const showConversationExport = detail.transcriptLocked || detail.conversationMarkdown !== null;

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

    return (
        <div className="space-y-6">
            <PageHeader
                actions={
                    <AntigravityConversationHeaderActions
                        detail={detail}
                        exportArtifactsPending={exportArtifactsMutation.isPending}
                        exportConversationPending={exportConversationMutation.isPending}
                        showConversationExport={showConversationExport}
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

            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <MetadataSection items={buildConversationMetadata(detail)} title="Conversation metadata" />
                <AntigravityConversationPanels detail={detail} />
            </div>

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
        </div>
    );
}
