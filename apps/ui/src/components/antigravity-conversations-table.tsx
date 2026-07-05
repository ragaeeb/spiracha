import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import type { AntigravityDecryptionState } from '@spiracha/lib/antigravity-keychain';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, LockKeyhole, MoreHorizontal, ScrollText, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import {
    canExportAntigravityConversation,
    hasEncryptedAntigravityConversation,
    hasReadableAntigravityConversation,
    isAntigravityConversationLocked,
} from '#/lib/antigravity-conversation-state';
import { formatBytes, formatDateTime, formatNumber } from '#/lib/formatters';

type AntigravityConversationsTableProps = {
    conversations: AntigravityConversation[];
    decryptionState: AntigravityDecryptionState | null;
    onDeleteConversation: (conversation: AntigravityConversation) => void;
    onExportArtifacts: (conversation: AntigravityConversation) => void;
    onExportConversation: (conversation: AntigravityConversation) => void;
};

type ConversationExportState = {
    canExportConversation: boolean;
    hasArtifacts: boolean;
    hasTranscript: boolean;
    lockedTranscript: boolean;
    showConversationAction: boolean;
};

const columnHelper = createColumnHelper<AntigravityConversation>();

const getConversationExportState = (
    conversation: AntigravityConversation,
    decryptionState: AntigravityDecryptionState | null,
): ConversationExportState => {
    const hasArtifacts = conversation.artifactCount > 0;
    const isUnlocked = Boolean(decryptionState?.isUnlocked);
    const hasTranscript =
        hasReadableAntigravityConversation(conversation) || hasEncryptedAntigravityConversation(conversation);
    const canExportConversation = canExportAntigravityConversation(conversation, isUnlocked);
    const lockedTranscript = isAntigravityConversationLocked(conversation, isUnlocked);
    const showConversationAction = canExportConversation || lockedTranscript;

    return {
        canExportConversation,
        hasArtifacts,
        hasTranscript,
        lockedTranscript,
        showConversationAction,
    };
};

const getTranscriptLabel = (
    conversation: AntigravityConversation,
    exportState: Pick<ConversationExportState, 'hasTranscript' | 'lockedTranscript'>,
) => {
    if (!exportState.hasTranscript) {
        return 'Summary only';
    }

    const source = conversation.transcriptSource ? conversation.transcriptSource.replace(/-/gu, ' ') : 'transcript';
    const status = exportState.lockedTranscript ? 'locked' : 'available';
    return `${source} · ${status}`;
};

const columns = (
    decryptionState: AntigravityDecryptionState | null,
    onDeleteConversation: (conversation: AntigravityConversation) => void,
    onExportConversation: (conversation: AntigravityConversation) => void,
    onExportArtifacts: (conversation: AntigravityConversation) => void,
) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => {
                const exportState = getConversationExportState(info.row.original, decryptionState);

                return (
                    <Link
                        className="block w-[16rem] max-w-[22rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                        params={{ conversationId: info.row.original.conversationId }}
                        to="/antigravity-conversations/$conversationId"
                    >
                        <div className="flex items-center gap-2">
                            <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                            {exportState.hasTranscript ? <Badge variant="secondary">transcript</Badge> : null}
                            {exportState.hasArtifacts ? <Badge variant="outline">artifact</Badge> : null}
                        </div>
                        <p className="truncate text-[var(--muted-foreground)] text-xs">
                            {info.row.original.conversationId}
                        </p>
                    </Link>
                );
            },
            header: 'Conversation',
        }),
        columnHelper.accessor('lastUpdatedAtMs', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Updated',
        }),
        columnHelper.display({
            cell: (info) => {
                const exportState = getConversationExportState(info.row.original, decryptionState);
                return (
                    <span className="text-sm">
                        {getTranscriptLabel(info.row.original, exportState)}
                        {info.row.original.transcriptEntryCount > 0
                            ? ` · ${formatNumber(info.row.original.transcriptEntryCount)} entries`
                            : ''}
                    </span>
                );
            },
            header: 'Transcript',
            id: 'transcript',
        }),
        columnHelper.accessor('artifactCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Artifacts',
        }),
        columnHelper.accessor('conversationBytes', {
            cell: (info) => <span className="font-mono text-sm">{formatBytes(info.getValue())}</span>,
            header: 'Size',
        }),
        columnHelper.display({
            cell: (info) => {
                const exportState = getConversationExportState(info.row.original, decryptionState);
                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                className="rounded-full"
                                size="icon"
                                type="button"
                                variant="ghost"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <MoreHorizontal className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {exportState.showConversationAction ? (
                                <DropdownMenuItem
                                    disabled={!exportState.canExportConversation}
                                    onClick={() => onExportConversation(info.row.original)}
                                >
                                    {exportState.lockedTranscript ? (
                                        <LockKeyhole className="mr-2 size-4" />
                                    ) : (
                                        <Download className="mr-2 size-4" />
                                    )}
                                    {exportState.lockedTranscript
                                        ? 'Unlock conversation export first'
                                        : 'Export conversation'}
                                </DropdownMenuItem>
                            ) : null}
                            {exportState.hasArtifacts ? (
                                <DropdownMenuItem onClick={() => onExportArtifacts(info.row.original)}>
                                    <ScrollText className="mr-2 size-4" />
                                    Export artifacts
                                </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem onClick={() => onDeleteConversation(info.row.original)}>
                                <Trash2 className="mr-2 size-4" />
                                Delete conversation
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                );
            },
            header: '',
            id: 'actions',
        }),
    ] as const;

export function AntigravityConversationsTable({
    conversations,
    decryptionState,
    onDeleteConversation,
    onExportArtifacts,
    onExportConversation,
}: AntigravityConversationsTableProps) {
    const tableColumns = useMemo(
        () => columns(decryptionState, onDeleteConversation, onExportConversation, onExportArtifacts),
        [decryptionState, onDeleteConversation, onExportArtifacts, onExportConversation],
    );

    return (
        <DataTable
            columns={tableColumns}
            data={conversations}
            emptyMessage="No Antigravity conversations match the current workspace filter."
        />
    );
}
