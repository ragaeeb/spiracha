import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import type { AntigravityDecryptionState } from '@spiracha/lib/antigravity-keychain';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, LockKeyhole, MoreHorizontal, ScrollText, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { SelectionActionsToolbar } from '#/components/selection-actions-toolbar';
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
    onDeleteConversations: (conversationIds: string[]) => void;
    onExportArtifacts: (conversation: AntigravityConversation) => void;
    onExportConversation: (conversation: AntigravityConversation) => void;
    onExportConversations: (conversationIds: string[]) => void;
};

type ConversationExportState = {
    canExportConversation: boolean;
    hasArtifacts: boolean;
    hasTranscript: boolean;
    lockedTranscript: boolean;
    showConversationAction: boolean;
};

const columnHelper = createColumnHelper<AntigravityConversation>();
const defaultSorting: SortingState = [{ desc: true, id: 'updatedAt' }];

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

const getConversationSizeLabel = (conversation: AntigravityConversation): string => {
    if (conversation.totalBytes > 0) {
        return formatBytes(conversation.totalBytes);
    }

    return conversation.summaryPath ? 'Summary' : formatBytes(conversation.totalBytes);
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
            id: 'updatedAt',
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
        columnHelper.accessor('totalBytes', {
            cell: (info) => <span className="font-mono text-sm">{getConversationSizeLabel(info.row.original)}</span>,
            header: 'Size',
        }),
        columnHelper.display({
            cell: (info) => {
                const exportState = getConversationExportState(info.row.original, decryptionState);
                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                aria-label={`Actions for ${info.row.original.title}`}
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
                            <DropdownMenuItem
                                className="text-[var(--destructive)]"
                                onClick={() => onDeleteConversation(info.row.original)}
                            >
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
    onDeleteConversations,
    onExportArtifacts,
    onExportConversation,
    onExportConversations,
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
            enableRowSelection
            getRowId={(row) => row.conversationId}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => {
                const selectedConversationIds = selectedRows.map((row) => row.conversationId);
                const hasNonExportableSelection = selectedRows.some(
                    (row) => !getConversationExportState(row, decryptionState).canExportConversation,
                );
                return (
                    <SelectionActionsToolbar
                        clearSelection={clearSelection}
                        exportDisabled={hasNonExportableSelection}
                        itemLabel="conversation"
                        selectedCount={selectedRows.length}
                        onDeleteSelected={() => onDeleteConversations(selectedConversationIds)}
                        onExportSelected={() => onExportConversations(selectedConversationIds)}
                    />
                );
            }}
        />
    );
}
