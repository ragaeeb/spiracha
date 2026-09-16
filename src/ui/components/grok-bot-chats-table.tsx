import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { ConversationSelectionActions } from '#/components/selection-actions-toolbar';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { supportedListAction } from '#/lib/conversation-actions';
import type { ConversationListSelectionProps } from '#/lib/conversation-selection';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';
import type { GrokBotChat } from '#/lib/grok-bot-server';

type GrokBotChatsTableProps = {
    chats: GrokBotChat[];
    onDeleteChat: (chat: GrokBotChat) => void;
    onDeleteChats: (conversationIds: string[]) => void;
    onExportChat: (chat: GrokBotChat) => void;
    onExportChats: (conversationIds: string[]) => void;
} & ConversationListSelectionProps;

const columnHelper = createDataTableColumnHelper<GrokBotChat>();
const defaultSorting: SortingState = [{ desc: true, id: 'updated' }];

export const grokBotChatKindLabel = (conversation: GrokBotChat) =>
    conversation.metadata.chatKind === 'group' ? 'Group' : '1:1';

export const grokBotMemberNames = (conversation: GrokBotChat) => {
    const members = conversation.metadata.members;
    return Array.isArray(members)
        ? members.flatMap((member) => {
              if (typeof member !== 'object' || member === null || Array.isArray(member)) {
                  return [];
              }
              const name = (member as Record<string, unknown>).name;
              return typeof name === 'string' ? [name] : [];
          })
        : [];
};

const buildColumns = (onDeleteChat: (chat: GrokBotChat) => void, onExportChat: (chat: GrokBotChat) => void) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[24rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ conversationId: info.row.original.id }}
                    to="/grok-bot-chats/$conversationId"
                >
                    <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                    <p className="truncate font-mono text-[var(--muted-foreground)] text-xs">{info.row.original.id}</p>
                </Link>
            ),
            header: 'Chat',
        }),
        columnHelper.accessor('updatedAtMs', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Updated',
            id: 'updated',
        }),
        columnHelper.display({
            cell: (info) => <span className="text-sm">{grokBotChatKindLabel(info.row.original)}</span>,
            header: 'Type',
            id: 'chatKind',
        }),
        columnHelper.display({
            cell: (info) => (
                <span className="text-sm">{grokBotMemberNames(info.row.original).join(', ') || 'n/a'}</span>
            ),
            header: 'Participants',
            id: 'participants',
        }),
        columnHelper.accessor('messageCount', {
            cell: (info) => {
                const messageCount = info.getValue();
                return (
                    <span className="font-mono text-sm">
                        {messageCount === null ? 'n/a' : formatNumber(messageCount)}
                    </span>
                );
            },
            header: 'Messages',
        }),
        columnHelper.display({
            cell: (info) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            aria-label={`Actions for ${info.row.original.title ?? info.row.original.id}`}
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
                        <DropdownMenuItem onClick={() => onExportChat(info.row.original)}>
                            <Download className="mr-2 size-4" />
                            Export chat
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-[var(--destructive)] focus:text-[var(--destructive)]"
                            onClick={() => onDeleteChat(info.row.original)}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete chat
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
            enableSorting: false,
            header: '',
            id: 'actions',
        }),
    ] as const;

export const GrokBotChatsTable = ({
    authoritativeRowIds,
    chats,
    inventoryIdentity,
    onDeleteChat,
    onDeleteChats,
    onExportChat,
    onExportChats,
}: GrokBotChatsTableProps) => {
    const columns = useMemo(() => buildColumns(onDeleteChat, onExportChat), [onDeleteChat, onExportChat]);

    return (
        <DataTable
            authoritativeRowIds={authoritativeRowIds}
            columns={columns}
            data={chats}
            emptyMessage="No Grok Bot chats match the current search."
            enableRowSelection
            getRowId={(conversation) => conversation.id}
            initialSorting={defaultSorting}
            inventoryIdentity={inventoryIdentity}
            renderToolbar={({ clearSelection, hiddenSelectedCount, selectedIds }) => (
                <ConversationSelectionActions
                    clearSelection={clearSelection}
                    deleteAction={supportedListAction(() => onDeleteChats(selectedIds))}
                    exportAction={supportedListAction(() => onExportChats(selectedIds))}
                    hiddenSelectedCount={hiddenSelectedCount}
                    itemLabel="chat"
                    selectedCount={selectedIds.length}
                />
            )}
        />
    );
};
