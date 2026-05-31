import type { CursorThreadSummary, CursorWorkspaceGroup } from '@spiracha/lib/cursor-exporter-types';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { RefreshCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DeleteConfirmDialog } from '#/components/delete-confirm-dialog';
import { PageHeader } from '#/components/page-header';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { cursorThreadsQueryOptions, cursorWorkspacesQueryOptions } from '#/lib/cursor-queries';
import {
    deleteCursorThreadsFn,
    deleteCursorWorkspaceFn,
    exportCursorThreadFn,
    recoverCursorWorkspaceFn,
} from '#/lib/cursor-server';
import { downloadTextFile } from '#/lib/download';
import { formatBytes, formatDateTime, formatNumber } from '#/lib/formatters';
import { cn } from '#/lib/utils';

export const Route = createFileRoute('/cursor')({
    component: CursorPage,
    errorComponent: CursorErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(cursorWorkspacesQueryOptions()),
});

function CursorErrorComponent({ error }: { error: Error }) {
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-6 py-10 text-center">
            <p className="font-medium text-[var(--destructive)] text-sm">Failed to load Cursor workspaces</p>
            <p className="mt-2 text-[var(--muted-foreground)] text-sm">{error.message}</p>
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

function CursorPage() {
    const workspaces = useSuspenseQuery(cursorWorkspacesQueryOptions()).data;
    const [selectedKey, setSelectedKey] = useState<string | null>(workspaces[0]?.key ?? null);
    const selected = workspaces.find((workspace) => workspace.key === selectedKey) ?? null;

    return (
        <div className="space-y-6">
            <PageHeader
                actions={<RecoverButton workspace={selected} />}
                eyebrow="Local Cursor data"
                subtitle="Workspaces are grouped from Cursor's chat storage and file-history activity. Export preserves user, assistant, reasoning, and tool-call content."
                title="Cursor workspaces"
            />

            <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <WorkspaceList selectedKey={selectedKey} workspaces={workspaces} onSelect={setSelectedKey} />
                <ThreadPanel workspace={selected} />
            </div>
        </div>
    );
}

function WorkspaceList({
    workspaces,
    selectedKey,
    onSelect,
}: {
    workspaces: CursorWorkspaceGroup[];
    selectedKey: string | null;
    onSelect: (key: string) => void;
}) {
    if (workspaces.length === 0) {
        return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-6 text-[var(--muted-foreground)] text-sm">
                No Cursor workspaces found on disk.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {workspaces.map((workspace) => (
                <WorkspaceButton
                    key={workspace.key}
                    selected={workspace.key === selectedKey}
                    workspace={workspace}
                    onSelect={() => onSelect(workspace.key)}
                />
            ))}
        </div>
    );
}

function WorkspaceButton({
    workspace,
    selected,
    onSelect,
}: {
    workspace: CursorWorkspaceGroup;
    selected: boolean;
    onSelect: () => void;
}) {
    const activityOnly = workspace.buckets.length === 0 && workspace.threadCount === 0;
    const sourceLabel = activityOnly ? 'file history' : `${workspace.buckets.length} bucket(s)`;

    return (
        <button
            className={cn(
                'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                selected
                    ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
                    : 'border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-secondary)]',
            )}
            type="button"
            onClick={onSelect}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-sm">{workspace.label}</span>
                {activityOnly ? <Badge variant="secondary">activity</Badge> : null}
                {workspace.needsRecovery ? <Badge variant="outline">recover</Badge> : null}
            </div>
            <p className="mt-1 truncate text-[var(--muted-foreground)] text-xs">
                {workspace.folders[0] ?? workspace.uri}
            </p>
            <p className="mt-1 text-[var(--muted-foreground)] text-xs">
                ~{formatNumber(workspace.threadCount)} threads · {sourceLabel} ·{' '}
                {formatDateTime(workspace.lastActiveMs)}
            </p>
        </button>
    );
}

function RecoverButton({ workspace }: { workspace: CursorWorkspaceGroup | null }) {
    const queryClient = useQueryClient();
    const recoverable = workspace !== null && workspace.buckets.length > 1;

    const recoverMutation = useMutation({
        mutationFn: () => {
            if (!workspace) {
                throw new Error('No workspace selected');
            }

            return recoverCursorWorkspaceFn({ data: { apply: true, workspaceKey: workspace.key } });
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['cursor-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['cursor-threads', workspace?.key ?? 'none'] }),
            ]);
        },
    });

    return (
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
            <Button
                className="rounded-full"
                disabled={!recoverable || recoverMutation.isPending}
                type="button"
                variant="outline"
                onClick={() => recoverMutation.mutate()}
            >
                <RefreshCcw className="mr-2 size-4" />
                {recoverMutation.isPending ? 'Recovering...' : 'Recover'}
            </Button>
            {recoverMutation.isSuccess ? (
                <span className="text-[var(--muted-foreground)] text-xs">
                    Merged {recoverMutation.data.mergedThreadCount} thread(s). Reopen Cursor to see them in Chat
                    History.
                </span>
            ) : null}
            {recoverMutation.isError ? (
                <span className="text-[var(--destructive)] text-xs">
                    {recoverMutation.error instanceof Error ? recoverMutation.error.message : 'Recovery failed'}
                </span>
            ) : null}
        </div>
    );
}

type PendingDelete =
    | { kind: 'thread'; thread: CursorThreadSummary }
    | { kind: 'workspace'; workspace: CursorWorkspaceGroup };

function ThreadPanel({ workspace }: { workspace: CursorWorkspaceGroup | null }) {
    const queryClient = useQueryClient();
    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
    const threadsQuery = useQuery(cursorThreadsQueryOptions(workspace?.key ?? null));

    const deleteMutation = useMutation({
        mutationFn: (target: PendingDelete) =>
            target.kind === 'workspace'
                ? deleteCursorWorkspaceFn({ data: { workspaceKey: target.workspace.key } })
                : deleteCursorThreadsFn({ data: { composerIds: [target.thread.composerId] } }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['cursor-workspaces'] }),
                queryClient.invalidateQueries({ queryKey: ['cursor-threads', workspace?.key ?? 'none'] }),
            ]);
            setPendingDelete(null);
        },
    });

    if (!workspace) {
        return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-6 text-[var(--muted-foreground)] text-sm">
                Select a workspace to view its threads.
            </div>
        );
    }

    const threads = threadsQuery.data ?? [];
    const populated = threads.filter((thread) => thread.bubbleCount > 0).length;
    const empty = threads.length - populated;

    return (
        <div className="space-y-4">
            {workspace.needsRecovery ? <RecoverNotice /> : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[var(--muted-foreground)] text-xs">
                    {threadsQuery.isLoading
                        ? 'Loading threads...'
                        : `${formatNumber(populated)} with messages${empty > 0 ? ` · ${formatNumber(empty)} empty` : ''}`}
                </p>
                {threads.length > 0 ? (
                    <Button
                        className="rounded-full"
                        disabled={deleteMutation.isPending}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => setPendingDelete({ kind: 'workspace', workspace })}
                    >
                        <Trash2 className="mr-2 size-4" />
                        Delete workspace
                    </Button>
                ) : null}
            </div>

            <ThreadList
                deletingComposerId={
                    deleteMutation.isPending && deleteMutation.variables?.kind === 'thread'
                        ? deleteMutation.variables.thread.composerId
                        : null
                }
                threads={threads}
                onDelete={(thread) => setPendingDelete({ kind: 'thread', thread })}
            />

            {deleteMutation.isError ? (
                <p className="text-[var(--destructive)] text-xs">
                    {deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Delete failed'}
                </p>
            ) : null}

            <DeleteConfirmDialog
                confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete permanently'}
                description={describeDelete(pendingDelete)}
                open={pendingDelete !== null}
                title={pendingDelete?.kind === 'workspace' ? 'Delete entire workspace?' : 'Delete this thread?'}
                onConfirm={() => {
                    if (pendingDelete) {
                        deleteMutation.mutate(pendingDelete);
                    }
                }}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDelete(null);
                    }
                }}
            />
        </div>
    );
}

function describeDelete(pending: PendingDelete | null): string {
    if (!pending) {
        return '';
    }

    if (pending.kind === 'workspace') {
        return `Permanently delete every thread for "${pending.workspace.label}" from Cursor's database (message bubbles, thread metadata, and headers) and remove their on-disk transcript files. Quit Cursor first. This cannot be undone.`;
    }

    return `Permanently delete "${pending.thread.name}" from Cursor's database (its ${pending.thread.bubbleCount} messages, thread metadata, and header) and remove its on-disk transcript files. Quit Cursor first. This cannot be undone.`;
}

function RecoverNotice() {
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-4">
            <p className="font-medium text-sm">This workspace has threads in an older storage bucket.</p>
            <p className="mt-1 text-[var(--muted-foreground)] text-xs">
                Use the <span className="font-medium">Recover</span> button above to merge every thread into the bucket
                Cursor uses now so they reappear in Chat History. Quit Cursor before recovering.
            </p>
        </div>
    );
}

function ThreadList({
    threads,
    deletingComposerId,
    onDelete,
}: {
    threads: CursorThreadSummary[];
    deletingComposerId: string | null;
    onDelete: (thread: CursorThreadSummary) => void;
}) {
    if (threads.length === 0) {
        return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-6 text-[var(--muted-foreground)] text-sm">
                No threads found for this workspace.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {threads.map((thread) => (
                <ThreadRow
                    key={thread.composerId}
                    deleting={deletingComposerId === thread.composerId}
                    thread={thread}
                    onDelete={() => onDelete(thread)}
                />
            ))}
        </div>
    );
}

function ThreadRow({
    thread,
    deleting,
    onDelete,
}: {
    thread: CursorThreadSummary;
    deleting: boolean;
    onDelete: () => void;
}) {
    const hasMessages = thread.bubbleCount > 0;
    const exportMutation = useMutation({
        mutationFn: (includeTools: boolean) =>
            exportCursorThreadFn({
                data: {
                    composerId: thread.composerId,
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools,
                    outputFormat: 'md',
                },
            }),
        onSuccess: (result) => {
            downloadTextFile(result.filename, result.content, 'text/markdown; charset=utf-8');
        },
    });

    return (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
            <div className="min-w-0">
                <p className="truncate font-medium text-sm">{thread.name}</p>
                <p className="mt-0.5 text-[var(--muted-foreground)] text-xs">
                    {hasMessages
                        ? `${formatNumber(thread.bubbleCount)} messages · ${formatBytes(thread.bubbleBytes)} · ${formatDateTime(thread.lastUpdatedAtMs)}`
                        : 'No messages'}
                </p>
            </div>
            <div className="flex shrink-0 gap-2">
                {hasMessages ? (
                    <Button disabled={exportMutation.isPending} onClick={() => exportMutation.mutate(true)}>
                        {exportMutation.isPending ? 'Exporting...' : 'Export .md'}
                    </Button>
                ) : null}
                <Button aria-label="Delete thread" disabled={deleting} size="icon" variant="outline" onClick={onDelete}>
                    <Trash2 className="size-4" />
                </Button>
            </div>
        </div>
    );
}
