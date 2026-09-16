import type { WebChatConversationSummary } from '@spiracha/lib/web-chat';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '#/components/data-table';
import { SelectionActionsToolbar } from '#/components/selection-actions-toolbar';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type WebConversationsTableProps = {
    conversations: WebChatConversationSummary[];
    onDeleteChat: (conversation: WebChatConversationSummary) => void;
    onDeleteChats: (conversationIds: string[]) => void;
    onExportChat: (conversation: WebChatConversationSummary) => void;
    onExportChats: (conversationIds: string[]) => void;
};

const columnHelper = createDataTableColumnHelper<WebChatConversationSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'lastActive' }];

const buildColumns = (
    onDeleteChat: (conversation: WebChatConversationSummary) => void,
    onExportChat: (conversation: WebChatConversationSummary) => void,
) =>
    [
        columnHelper.accessor('title', {
            cell: (info) => (
                <Link
                    className="block w-[16rem] max-w-[24rem] space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-auto"
                    params={{ conversationId: info.row.original.id }}
                    to="/web-chats/$conversationId"
                >
                    <p className="truncate font-medium underline-offset-2 hover:underline">{info.getValue()}</p>
                    <p className="truncate text-[var(--muted-foreground)] text-xs">
                        {info.row.original.sourceConversationId ?? info.row.original.id}
                    </p>
                </Link>
            ),
            header: 'Conversation',
        }),
        columnHelper.accessor('lastActiveAtMs', {
            cell: (info) => (
                <span className="whitespace-nowrap text-sm" suppressHydrationWarning>
                    {formatDateTime(info.getValue())}
                </span>
            ),
            header: 'Updated',
            id: 'lastActive',
        }),
        columnHelper.accessor('platform', {
            cell: (info) => <span className="text-sm">{info.getValue()}</span>,
            header: 'Platform',
        }),
        columnHelper.accessor('model', {
            cell: (info) => <span className="text-sm">{info.getValue() ?? 'unknown'}</span>,
            header: 'Model',
        }),
        columnHelper.accessor('messageCount', {
            cell: (info) => <span className="font-mono text-sm">{formatNumber(info.getValue())}</span>,
            header: 'Messages',
        }),
        columnHelper.accessor('fileName', {
            cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
            header: 'Imported file',
        }),
        columnHelper.display({
            cell: (info) => (
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

export const WebConversationsTable = ({
    conversations,
    onDeleteChat,
    onDeleteChats,
    onExportChat,
    onExportChats,
}: WebConversationsTableProps) => {
    const columns = useMemo(() => buildColumns(onDeleteChat, onExportChat), [onDeleteChat, onExportChat]);

    return (
        <DataTable
            columns={columns}
            data={conversations}
            emptyMessage="Drop one or more exported web chats to inspect them here."
            enableRowSelection
            getRowId={(row) => row.id}
            initialSorting={defaultSorting}
            renderToolbar={({ clearSelection, selectedRows }) => (
                <SelectionActionsToolbar
                    clearSelection={clearSelection}
                    itemLabel="chat"
                    selectedCount={selectedRows.length}
                    onDeleteSelected={() => onDeleteChats(selectedRows.map((row) => row.id))}
                    onExportSelected={() => onExportChats(selectedRows.map((row) => row.id))}
                />
            )}
        />
    );
};
