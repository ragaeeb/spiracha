import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Breadcrumbs } from '#/components/breadcrumbs';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { ExportDialog } from '#/components/export-dialog';
import { JsonPanel } from '#/components/json-panel';
import { LoadingPanel } from '#/components/loading-panel';
import { MetadataSection } from '#/components/metadata-section';
import { MetricCard } from '#/components/metric-card';
import { PageHeader } from '#/components/page-header';
import { ReloadErrorPanel } from '#/components/reload-error-panel';
import { TextDocumentPanel } from '#/components/text-document-panel';
import { Button } from '#/components/ui/button';
import { cursorThreadDetailQueryOptions } from '#/lib/cursor-queries';
import { deleteCursorThreadsFn, exportCursorThreadFn, type getCursorThreadDetailFn } from '#/lib/cursor-server';
import { downloadTextFile } from '#/lib/download';
import { formatBytes, formatDateTime, formatNumber } from '#/lib/formatters';

type CursorThreadDetail = Awaited<ReturnType<typeof getCursorThreadDetailFn>>;

type ExportDialogOptions = {
    includeCommentary: boolean;
    includeMetadata: boolean;
    includeTools: boolean;
    outputFormat: 'md' | 'txt';
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

const getCursorExportMimeType = (outputFormat: 'md' | 'txt') => {
    return outputFormat === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
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

function CursorThreadDetailErrorComponent({ error }: { error: Error }) {
    return <ReloadErrorPanel description={error.message} title="Failed to load Cursor thread" />;
}

function CursorThreadDetailPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const detail = useSuspenseQuery(cursorThreadDetailQueryOptions(Route.useParams().composerId)).data;
    const [pendingDelete, setPendingDelete] = useState(false);
    const [pendingExport, setPendingExport] = useState(false);

    const deleteThreadMutation = useMutation({
        mutationFn: () => deleteCursorThreadsFn({ data: { composerIds: [detail.thread.composerId] } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['cursor-thread', detail.thread.composerId] }),
                queryClient.invalidateQueries({ queryKey: ['cursor-threads', detail.thread.workspaceKey] }),
                queryClient.invalidateQueries({ queryKey: ['cursor-workspaces'] }),
            ]);
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

            downloadTextFile(download.filename, download.content, getCursorExportMimeType(options.outputFormat));
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

            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <MetadataSection items={buildCursorThreadMetadata(detail)} title="Thread metadata" />
                {detail.renderedTranscript ? (
                    <TextDocumentPanel
                        content={detail.renderedTranscript}
                        description="Rendered with commentary and tool calls enabled."
                        title="Transcript"
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
            </div>

            {detail.transcript ? <JsonPanel title="Raw transcript" value={detail.transcript} /> : null}

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
}
