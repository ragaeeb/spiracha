import type { ConversationDetail, ConversationMessage } from '@spiracha/lib/conversation-data/types';
import type { JsonValue } from '@spiracha/lib/shared';
import {
    cleanExtractedText,
    cleanInlineTitle,
    formatInlineLiteral,
    renderCodeBlock,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
} from '@spiracha/lib/shared';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { renderSourceSessionDownload } from './source-session-export-server';

const conversationSchema = z.object({
    conversationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u),
});

const exportSchema = conversationSchema.extend({
    includeCommentary: z.boolean().default(false),
    includeMetadata: z.boolean().default(true),
    includeTools: z.boolean().default(true),
    outputFormat: z.enum(['md', 'txt']).default('md'),
    zipArchive: z.boolean().default(false),
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

const getMessageTitle = (message: ConversationMessage) => {
    if (message.role === 'user') {
        return 'User';
    }
    if (message.role === 'tool') {
        return 'Tool';
    }
    const authorName = message.metadata.authorName;
    return typeof authorName === 'string' && authorName.trim()
        ? cleanInlineTitle(authorName)
        : message.role === 'assistant'
          ? 'Assistant'
          : 'Message';
};

const renderGrokBotMessage = (
    message: ConversationMessage,
    options: Pick<z.output<typeof exportSchema>, 'includeCommentary' | 'includeTools' | 'outputFormat'>,
) => {
    if ((message.phase === 'commentary' || message.phase === 'reasoning') && !options.includeCommentary) {
        return '';
    }
    if ((message.phase === 'tool_call' || message.phase === 'tool_output') && !options.includeTools) {
        return '';
    }

    const text = cleanExtractedText(message.text).trim();
    if (message.phase === 'tool_call') {
        const tool = message.toolEvidence;
        const toolName = tool?.name ?? 'unknown';
        const lines = [`Tool: ${formatInlineLiteral(toolName, options.outputFormat)}`];
        if (tool?.callId) {
            lines.push(`Call ID: ${tool.callId}`);
        }
        if (tool?.inputText?.trim()) {
            lines.push('', 'Input:', '', renderCodeBlock(tool.inputText.trim(), options.outputFormat));
        }
        return renderSection('Tool Call', lines.join('\n'), options.outputFormat);
    }
    if (message.phase === 'tool_output') {
        const outputText = message.toolEvidence?.outputText?.trim() || text;
        return renderSection('Tool Output', outputText, options.outputFormat);
    }
    if (message.phase === 'reasoning') {
        return renderSection('Reasoning', text, options.outputFormat);
    }

    return renderSection(getMessageTitle(message), text, options.outputFormat);
};

const renderGrokBotChat = (
    conversation: GrokBotChat,
    options: Pick<
        z.output<typeof exportSchema>,
        'includeCommentary' | 'includeMetadata' | 'includeTools' | 'outputFormat'
    >,
) => {
    const sections = conversation.messages.map((message) => renderGrokBotMessage(message, options)).filter(Boolean);
    if (sections.length === 0) {
        return null;
    }

    const title = cleanInlineTitle(conversation.title ?? conversation.id);
    const metadata = options.includeMetadata
        ? renderMetadataBlock(
              [
                  { key: 'exported_from', value: 'grok_bot' },
                  { key: 'conversation_id', value: conversation.id },
                  { key: 'title', value: conversation.title },
                  { key: 'chat_kind', value: conversation.metadata.chatKind },
                  { key: 'participants', value: getMemberNames(conversation).join(', ') },
                  { key: 'message_count', value: conversation.messages.length },
              ],
              options.outputFormat,
          )
        : '';

    return `${[renderDocumentTitle(title, options.outputFormat), '', metadata, ...sections]
        .filter(Boolean)
        .join('\n')
        .trimEnd()}\n`;
};

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
        const conversation = await loadGrokBotChat(data.conversationId);
        const content = renderGrokBotChat(conversation, data);
        if (!content) {
            throw new Error(`Grok Bot chat has no exportable content: ${conversation.id}`);
        }

        return renderSourceSessionDownload({
            content,
            cwd: null,
            fallbackBaseName: 'grok-bot-chat',
            outputFormat: data.outputFormat,
            platform: 'grok-bot',
            sessionId: conversation.id,
            updatedAtMs: conversation.updatedAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const deleteGrokBotChatFn = createServerFn({ method: 'POST' })
    .validator(conversationSchema)
    .handler(async ({ data }) => {
        const { deleteConversation } = await import('@spiracha/lib/conversation-data');
        const result = await deleteConversation({ id: data.conversationId, source: 'grok-bot' });
        if (!result || result.deletedIds.length === 0) {
            throw new Error(`Grok Bot chat not found: ${data.conversationId}`);
        }
        return result;
    });

export const grokBotChatsQueryOptions = () =>
    queryOptions({
        queryFn: () => listGrokBotChatsFn(),
        queryKey: ['grok-bot-chats'],
    });

export const grokBotChatQueryOptions = (conversationId: string | null) =>
    queryOptions({
        enabled: conversationId !== null,
        gcTime: 60_000,
        queryFn: () => getGrokBotChatFn({ data: { conversationId: conversationId ?? '' } }),
        queryKey: ['grok-bot-chat', conversationId ?? 'none'],
    });
