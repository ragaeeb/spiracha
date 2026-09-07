import type { ConversationDetail } from '@spiracha/lib/conversation-data/types';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { SortingState } from '@tanstack/react-table';
import { useDeferredValue, useMemo, useState } from 'react';
import { DataTable } from '#/components/data-table';
import { ListSearchInput } from '#/components/list-search-input';
import { LoadingPanel } from '#/components/loading-panel';
import { PageHeader } from '#/components/page-header';
import { RouteErrorPanel } from '#/components/route-error-panel';
import { createDataTableColumnHelper } from '#/lib/data-table-config';
import { formatDateTime, formatNumber } from '#/lib/formatters';
import { grokBotChatsQueryOptions } from '#/lib/grok-bot-server';
import { matchesTextQuery } from '#/lib/text-filter';

const columnHelper = createDataTableColumnHelper<ConversationDetail>();
const defaultSorting: SortingState = [{ desc: true, id: 'updated' }];

const getChatKind = (conversation: ConversationDetail) =>
    conversation.metadata.chatKind === 'group' ? 'Group' : '1:1';

const getMemberNames = (conversation: ConversationDetail) => {
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

const columns = [
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
        cell: (info) => <span className="text-sm">{getChatKind(info.row.original)}</span>,
        header: 'Type',
        id: 'chatKind',
    }),
    columnHelper.display({
        cell: (info) => <span className="text-sm">{getMemberNames(info.row.original).join(', ') || 'n/a'}</span>,
        header: 'Participants',
        id: 'participants',
    }),
    columnHelper.accessor('messageCount', {
        cell: (info) => {
            const messageCount = info.getValue();
            return (
                <span className="font-mono text-sm">{messageCount === null ? 'n/a' : formatNumber(messageCount)}</span>
            );
        },
        header: 'Messages',
    }),
] as const;

const GrokBotPage = () => {
    const conversations = useSuspenseQuery(grokBotChatsQueryOptions()).data;
    const [searchInput, setSearchInput] = useState('');
    const deferredSearch = useDeferredValue(searchInput);
    const visibleConversations = useMemo(
        () =>
            conversations.filter((conversation) =>
                matchesTextQuery(deferredSearch, [
                    conversation.title,
                    conversation.id,
                    getChatKind(conversation),
                    ...getMemberNames(conversation),
                ]),
            ),
        [conversations, deferredSearch],
    );

    return (
        <div className="space-y-4">
            <PageHeader
                actions={
                    <ListSearchInput
                        placeholder="Search chats, agents, or ids"
                        value={searchInput}
                        onValueChange={setSearchInput}
                    />
                }
                eyebrow="Global chats"
                subtitle="Conversations persisted by the installed Grok Bot macOS app."
                title="Grok Bot"
            />
            <DataTable
                columns={columns}
                data={visibleConversations}
                emptyMessage="No Grok Bot chats match the current search."
                getRowId={(conversation) => conversation.id}
                initialSorting={defaultSorting}
            />
        </div>
    );
};

export const Route = createFileRoute('/grok-bot/')({
    component: GrokBotPage,
    errorComponent: ({ error }) => <RouteErrorPanel error={error} title="Failed to load Grok Bot chats" />,
    loader: ({ context }) => context.queryClient.ensureQueryData(grokBotChatsQueryOptions()),
    pendingComponent: () => (
        <LoadingPanel description="Loading Grok Bot conversation metadata." title="Loading Grok Bot" />
    ),
    pendingMs: 0,
});
