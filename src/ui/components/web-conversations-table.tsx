import type { WebChatConversationSummary } from '@spiracha/lib/web-chat';
import { Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { DataTable } from '#/components/data-table';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';

type WebConversationsTableProps = {
    conversations: WebChatConversationSummary[];
};

const columnHelper = createDataTableColumnHelper<WebChatConversationSummary>();
const defaultSorting: SortingState = [{ desc: true, id: 'lastActive' }];
const columns = [
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
] as const;

export const WebConversationsTable = ({ conversations }: WebConversationsTableProps) => (
    <DataTable
        columns={columns}
        data={conversations}
        emptyMessage="Drop one or more exported web chats to inspect them here."
        getRowId={(row) => row.id}
        initialSorting={defaultSorting}
    />
);
