import type { AntigravityConversation, AntigravityWorkspaceGroup } from '@spiracha/lib/antigravity-exporter-types';
import type { AntigravityDecryptionState } from '@spiracha/lib/antigravity-keychain';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Download, KeyRound, LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '#/components/page-header';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
    antigravityConversationsQueryOptions,
    antigravityDecryptionQueryOptions,
    antigravityWorkspacesQueryOptions,
} from '#/lib/antigravity-queries';
import { exportAntigravityConversationFn, unlockAntigravityDecryptionFn } from '#/lib/antigravity-server';
import { downloadTextFile } from '#/lib/download';
import { formatBytes, formatDateTime, formatNumber } from '#/lib/formatters';
import { cn } from '#/lib/utils';

export const Route = createFileRoute('/antigravity')({
    component: AntigravityPage,
    errorComponent: AntigravityErrorComponent,
    loader: ({ context }) => context.queryClient.ensureQueryData(antigravityWorkspacesQueryOptions()),
});

function AntigravityErrorComponent({ error }: { error: Error }) {
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-6 py-10 text-center">
            <p className="font-medium text-[var(--destructive)] text-sm">Failed to load Antigravity conversations</p>
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

function AntigravityPage() {
    const workspaces = useSuspenseQuery(antigravityWorkspacesQueryOptions()).data;
    const [selectedKey, setSelectedKey] = useState<string | null>(workspaces[0]?.key ?? null);
    const selected = workspaces.find((workspace) => workspace.key === selectedKey) ?? null;

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Local Antigravity data"
                subtitle="Conversations are grouped from Antigravity's summary index, local logs, brain artifacts, and raw conversation files."
                title="Antigravity conversations"
            />

            <KeychainAccessPanel />

            <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <WorkspaceList selectedKey={selectedKey} workspaces={workspaces} onSelect={setSelectedKey} />
                <ConversationPanel workspace={selected} />
            </div>
        </div>
    );
}

function WorkspaceList({
    workspaces,
    selectedKey,
    onSelect,
}: {
    workspaces: AntigravityWorkspaceGroup[];
    selectedKey: string | null;
    onSelect: (key: string) => void;
}) {
    if (workspaces.length === 0) {
        return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-6 text-[var(--muted-foreground)] text-sm">
                No Antigravity conversations found on disk.
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
    workspace: AntigravityWorkspaceGroup;
    selected: boolean;
    onSelect: () => void;
}) {
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
                {workspace.artifactCount > 0 ? <Badge variant="secondary">artifacts</Badge> : null}
            </div>
            <p className="mt-1 truncate text-[var(--muted-foreground)] text-xs">{workspace.uri ?? workspace.key}</p>
            <p className="mt-1 text-[var(--muted-foreground)] text-xs">
                {formatNumber(workspace.conversationCount)} conversations · {formatBytes(workspace.conversationBytes)} ·{' '}
                {formatNumber(workspace.transcriptCount)} transcripts · {formatDateTime(workspace.lastActiveMs)}
            </p>
        </button>
    );
}

function KeychainAccessPanel() {
    const queryClient = useQueryClient();
    const decryptionQuery = useQuery(antigravityDecryptionQueryOptions());
    const decryptionState = decryptionQuery.data;
    const unlockMutation = useMutation({
        mutationFn: () => unlockAntigravityDecryptionFn(),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: antigravityDecryptionQueryOptions().queryKey });
        },
    });

    if (!decryptionState || decryptionState.status === 'unsupported') {
        return null;
    }

    const isUnlocked = decryptionState.isUnlocked || unlockMutation.data?.isUnlocked;
    const error = unlockMutation.data?.error ?? unlockMutation.error?.message ?? decryptionState.error;

    return (
        <div
            className={cn(
                'flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
                isUnlocked ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-[var(--border)] bg-[var(--panel)]',
            )}
        >
            <div className="flex min-w-0 items-start gap-3">
                <div
                    className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
                        isUnlocked ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[var(--panel-secondary)]',
                    )}
                >
                    {isUnlocked ? <ShieldCheck className="size-4" /> : <LockKeyhole className="size-4" />}
                </div>
                <div className="min-w-0">
                    <p className="font-medium text-sm">
                        {isUnlocked ? 'Keychain access enabled' : 'Unlock Antigravity transcript export'}
                    </p>
                    <p className="mt-1 text-[var(--muted-foreground)] text-xs">
                        {isUnlocked
                            ? 'The Antigravity key is cached in this server process only. Transcript exports are available for local logs and safe-storage payloads.'
                            : `Spiracha needs one-time access to ${decryptionState.keychainService} to decrypt Antigravity transcript data. macOS will ask for approval after you click unlock.`}
                    </p>
                    {error ? (
                        <p className="mt-2 flex items-center gap-1 text-[var(--destructive)] text-xs">
                            <TriangleAlert className="size-3" />
                            {error}
                        </p>
                    ) : null}
                </div>
            </div>
            {!isUnlocked ? (
                <Button
                    className="shrink-0"
                    disabled={!decryptionState.canRequestAccess || unlockMutation.isPending}
                    type="button"
                    onClick={() => unlockMutation.mutate()}
                >
                    <KeyRound className="size-4" />
                    {unlockMutation.isPending ? 'Waiting...' : 'Unlock'}
                </Button>
            ) : null}
        </div>
    );
}

function ConversationPanel({ workspace }: { workspace: AntigravityWorkspaceGroup | null }) {
    const conversationsQuery = useQuery(antigravityConversationsQueryOptions(workspace?.key ?? null));
    const decryptionQuery = useQuery(antigravityDecryptionQueryOptions());
    const decryptionState = decryptionQuery.data ?? null;

    if (!workspace) {
        return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-6 text-[var(--muted-foreground)] text-sm">
                Select a workspace to view its conversations.
            </div>
        );
    }

    const conversations = conversationsQuery.data ?? [];
    const artifactConversations = conversations.filter((conversation) => conversation.artifactCount > 0).length;
    const transcriptConversations = conversations.filter(
        (conversation) => conversation.transcriptEntryCount > 0,
    ).length;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[var(--muted-foreground)] text-xs">
                    {conversationsQuery.isLoading
                        ? 'Loading conversations...'
                        : `${formatNumber(conversations.length)} conversations${transcriptConversations > 0 ? ` · ${formatNumber(transcriptConversations)} with transcripts` : ''}${artifactConversations > 0 ? ` · ${formatNumber(artifactConversations)} with artifacts` : ''}`}
                </p>
            </div>

            <ConversationList conversations={conversations} decryptionState={decryptionState} />
        </div>
    );
}

function ConversationList({
    conversations,
    decryptionState,
}: {
    conversations: AntigravityConversation[];
    decryptionState: AntigravityDecryptionState | null;
}) {
    if (conversations.length === 0) {
        return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-6 text-[var(--muted-foreground)] text-sm">
                No conversations found for this workspace.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {conversations.map((conversation) => (
                <ConversationRow
                    conversation={conversation}
                    decryptionState={decryptionState}
                    key={conversation.conversationId}
                />
            ))}
        </div>
    );
}

type ConversationExportState = {
    canExport: boolean;
    hasArtifacts: boolean;
    hasTranscript: boolean;
    lockedTranscript: boolean;
    showButton: boolean;
};

const getConversationExportState = (
    conversation: AntigravityConversation,
    decryptionState: AntigravityDecryptionState | null,
): ConversationExportState => {
    const hasArtifacts = conversation.artifactCount > 0;
    const hasTranscript = conversation.transcriptEntryCount > 0;
    const hasRawPayload = conversation.conversationPath !== null;
    const isUnlocked = Boolean(decryptionState?.isUnlocked);
    const canExportArtifactsOnly = hasArtifacts && !hasTranscript;
    const canExportTranscript = hasTranscript && isUnlocked;
    const canTryEncryptedPayload = !hasTranscript && !hasArtifacts && hasRawPayload && isUnlocked;
    const canExport = canExportArtifactsOnly || canExportTranscript || canTryEncryptedPayload;
    const lockedTranscript = hasTranscript && !isUnlocked;

    return {
        canExport,
        hasArtifacts,
        hasTranscript,
        lockedTranscript,
        showButton: canExport || lockedTranscript,
    };
};

const getConversationSizeLabel = (
    conversation: AntigravityConversation,
    { hasArtifacts, hasTranscript }: Pick<ConversationExportState, 'hasArtifacts' | 'hasTranscript'>,
) =>
    [
        formatBytes(conversation.conversationBytes),
        hasTranscript ? `${formatNumber(conversation.transcriptEntryCount)} transcript events` : null,
        hasArtifacts ? `${formatNumber(conversation.artifactCount)} artifacts` : null,
        conversation.indexedItemCount !== null ? `${formatNumber(conversation.indexedItemCount)} indexed` : null,
    ]
        .filter(Boolean)
        .join(' · ');

const getExportButtonLabel = (isPending: boolean, lockedTranscript: boolean) => {
    if (isPending) {
        return 'Exporting...';
    }

    return lockedTranscript ? 'Unlock first' : 'Export';
};

function ConversationRow({
    conversation,
    decryptionState,
}: {
    conversation: AntigravityConversation;
    decryptionState: AntigravityDecryptionState | null;
}) {
    const exportMutation = useMutation({
        mutationFn: () => exportAntigravityConversationFn({ data: { conversationId: conversation.conversationId } }),
        onSuccess: (result) => {
            downloadTextFile(result.filename, result.content, 'text/markdown; charset=utf-8');
        },
    });

    const exportState = getConversationExportState(conversation, decryptionState);
    const sizeLabel = getConversationSizeLabel(conversation, exportState);
    const exportLabel = getExportButtonLabel(exportMutation.isPending, exportState.lockedTranscript);

    return (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-sm">{conversation.title}</p>
                    {exportState.hasTranscript ? <Badge variant="secondary">transcript</Badge> : null}
                    {exportState.hasArtifacts ? <Badge variant="outline">artifact</Badge> : null}
                </div>
                <p className="mt-0.5 text-[var(--muted-foreground)] text-xs">
                    {sizeLabel || 'Summary only'} · {formatDateTime(conversation.lastUpdatedAtMs)}
                </p>
                {exportMutation.isError ? (
                    <p className="mt-1 text-[var(--destructive)] text-xs">{exportMutation.error.message}</p>
                ) : null}
            </div>
            {exportState.showButton ? (
                <Button
                    className="shrink-0"
                    disabled={!exportState.canExport || exportMutation.isPending}
                    type="button"
                    onClick={() => exportMutation.mutate()}
                >
                    {exportState.lockedTranscript ? (
                        <LockKeyhole className="size-4" />
                    ) : (
                        <Download className="size-4" />
                    )}
                    {exportLabel}
                </Button>
            ) : null}
        </div>
    );
}
