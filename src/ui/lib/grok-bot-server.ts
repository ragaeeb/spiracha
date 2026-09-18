import { renderSelectedTranscriptExport } from '@spiracha/lib/conversation-data/conversation-export';
import { settleDeleteBatch } from '@spiracha/lib/conversation-data/mutation-executor';
import type { ConversationDetail, ConversationMessage } from '@spiracha/lib/conversation-data/types';
import type { JsonValue } from '@spiracha/lib/shared-text';
import { createServerFn } from '@tanstack/react-start';
import type { InferOutput } from 'valibot';
import { array, boolean, maxLength, minLength, object, optional, picklist, pipe, regex, string } from 'valibot';
import { renderSourceSessionDownload, renderSourceSessionsDownload } from './source-session-export-server';

const conversationIdSchema = pipe(string(), regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u));

const conversationSchema = object({
    conversationId: conversationIdSchema,
});

const exportOptionsSchema = {
    includeCommentary: optional(boolean(), false),
    includeMetadata: optional(boolean(), true),
    includeTools: optional(boolean(), true),
    outputFormat: optional(picklist(['md', 'txt']), 'md'),
    zipArchive: optional(boolean(), false),
    zipPassword: optional(string(), ''),
};

const exportSchema = object({
    conversationId: conversationIdSchema,
    ...exportOptionsSchema,
});

const exportChatsSchema = object({
    conversationIds: pipe(array(conversationIdSchema), minLength(1), maxLength(200)),
    ...exportOptionsSchema,
    zipArchive: optional(boolean(), true),
});

const deleteChatsSchema = object({
    conversationIds: pipe(array(conversationIdSchema), minLength(1), maxLength(200)),
});

export type GrokBotChat = Omit<ConversationDetail, 'messages' | 'metadata'> & {
    messages: Array<Omit<ConversationMessage, 'metadata'> & { metadata: Record<string, JsonValue> }>;
    metadata: Record<string, JsonValue>;
};

const serializeMetadata = (metadata: Record<string, unknown>): Record<string, JsonValue> =>
    JSON.parse(JSON.stringify(metadata)) as Record<string, JsonValue>;

const toSerializableChat = (conversation: ConversationDetail): GrokBotChat => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
        ...message,
        metadata: serializeMetadata(message.metadata),
    })),
    metadata: serializeMetadata(conversation.metadata),
});

const getMemberNames = (conversation: ConversationDetail) => {
    const members = conversation.metadata.members;
    return Array.isArray(members)
        ? members.flatMap((member) => {
              if (typeof member !== 'object' || member === null || Array.isArray(member)) {
                  return [];
              }
              const name = (member as Record<string, unknown>).name;
              return typeof name === 'string' && name.trim() ? [name] : [];
          })
        : [];
};

const exportTimestamp = (value: unknown): string | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildGrokBotExportMetadata = (conversation: GrokBotChat): Record<string, unknown> => ({
    agent_title: conversation.metadata.agentTitle,
    attachments: conversation.metadata.attachments,
    chat_kind: conversation.metadata.chatKind,
    conversation_id: conversation.id,
    created_at: exportTimestamp(conversation.createdAtMs),
    description: conversation.metadata.description,
    exported_from: 'grok_bot',
    last_activity_at: exportTimestamp(conversation.metadata.lastActivityAtMs),
    message_count: conversation.messages.length,
    participants: getMemberNames(conversation).join(', '),
    replica_persisted_at: exportTimestamp(conversation.metadata.replicaPersistedAtMs),
    roster_updated_at: exportTimestamp(conversation.metadata.rosterUpdatedAtMs),
    title: conversation.title,
});

const renderGrokBotChat = (
    conversation: GrokBotChat,
    options: Pick<
        InferOutput<typeof exportSchema>,
        'includeCommentary' | 'includeMetadata' | 'includeTools' | 'outputFormat'
    >,
) =>
    renderSelectedTranscriptExport(
        {
            artifacts: conversation.artifacts,
            bodyAvailability: conversation.bodyAvailability ?? 'full',
            messages: conversation.messages,
            metadata: buildGrokBotExportMetadata(conversation),
            ...(conversation.model ? { model: conversation.model } : {}),
            supplementalEvents: conversation.supplementalEvents,
            title: conversation.title ?? conversation.id,
        },
        {
            includeCommentary: options.includeCommentary,
            includeMetadata: options.includeMetadata,
            includeTools: options.includeTools,
            outputFormat: options.outputFormat,
        },
    );

const loadGrokBotChat = async (conversationId: string): Promise<GrokBotChat> => {
    const { getConversation } = await import('@spiracha/lib/conversation-data');
    const conversation = await getConversation({
        id: conversationId,
        messageSelector: 'all',
        source: 'grok-bot',
    });
    if (!conversation) {
        throw new Error(`Grok Bot chat not found: ${conversationId}`);
    }
    return toSerializableChat(conversation);
};

const renderLoadedGrokBotChat = async (
    conversationId: string,
    options: Pick<
        InferOutput<typeof exportSchema>,
        'includeCommentary' | 'includeMetadata' | 'includeTools' | 'outputFormat'
    >,
) => {
    const conversation = await loadGrokBotChat(conversationId);
    const content = renderGrokBotChat(conversation, options);
    if (!content) {
        throw new Error(`Grok Bot chat has no exportable content: ${conversation.id}`);
    }
    return { content, conversation };
};

const deleteLoadedGrokBotChat = async (conversationId: string) => {
    const { deleteConversation } = await import('@spiracha/lib/conversation-data');
    const result = await deleteConversation({ id: conversationId, source: 'grok-bot' });
    if (!result || result.deletedIds.length === 0) {
        throw new Error(`Grok Bot chat not found: ${conversationId}`);
    }
    if (result.cleanupFailures?.length) {
        throw new Error(
            `Roster entry removed; cleanup remains. Keep Grok Bot stopped and retry: ${result.cleanupFailures.map((failure) => failure.error).join('; ')}`,
        );
    }
    return result;
};

export const listGrokBotChatsFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listConversations } = await import('@spiracha/lib/conversation-data');
    return (await listConversations({ sources: ['grok-bot'] })).data.map(toSerializableChat);
});

export const getGrokBotChatFn = createServerFn({ method: 'GET' })
    .validator(conversationSchema)
    .handler(({ data }) => loadGrokBotChat(data.conversationId));

export const exportGrokBotChatFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        const { content, conversation } = await renderLoadedGrokBotChat(data.conversationId, data);
        return renderSourceSessionDownload({
            content,
            cwd: null,
            fallbackBaseName: 'grok-bot-chat',
            outputFormat: data.outputFormat,
            platform: 'grok-bot',
            sessionId: conversation.id,
            updatedAtMs: conversation.updatedAtMs,
            zipArchive: data.zipArchive,
            zipPassword: data.zipPassword,
        });
    });

export const exportGrokBotChatsFn = createServerFn({ method: 'POST' })
    .validator(exportChatsSchema)
    .handler(async ({ data }) => {
        const entries = [];
        for (const conversationId of data.conversationIds) {
            const { content, conversation } = await renderLoadedGrokBotChat(conversationId, data);
            entries.push({
                content,
                cwd: null,
                fallbackBaseName: 'grok-bot-chat',
                fileBaseName: conversation.title || conversation.id,
                sessionId: conversation.id,
                updatedAtMs: conversation.updatedAtMs,
            });
        }

        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'grok-bot-chats',
            outputFormat: data.outputFormat,
            platform: 'grok-bot',
            zipArchive: data.zipArchive,
            zipPassword: data.zipPassword,
        });
    });

export const deleteGrokBotChatFn = createServerFn({ method: 'POST' })
    .validator(conversationSchema)
    .handler(({ data }) => deleteLoadedGrokBotChat(data.conversationId));

export const deleteGrokBotChatsFn = createServerFn({ method: 'POST' })
    .validator(deleteChatsSchema)
    .handler(async ({ data }) => {
        const { deleteConversation } = await import('@spiracha/lib/conversation-data');
        return settleDeleteBatch({
            concurrency: 1,
            deleteOne: async (conversationId) =>
                (await deleteConversation({ id: conversationId, source: 'grok-bot' })) ?? {
                    deletedFiles: [],
                    deletedIds: [],
                },
            ids: data.conversationIds,
        });
    });
