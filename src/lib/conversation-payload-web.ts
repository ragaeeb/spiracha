import { normalizeCodexEvents } from './conversation-data/codex-messages';
import type { PayloadConversationDraft } from './conversation-payload-types';
import { parseWebChatFiles } from './web-chat';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const validateMessageCollections = (value: unknown): void => {
    if (Array.isArray(value)) {
        for (const item of value) {
            validateMessageCollections(item);
        }
        return;
    }
    if (!isRecord(value)) {
        return;
    }
    for (const key of ['messages', 'chat_messages']) {
        if (key in value && (!Array.isArray(value[key]) || !value[key].every(isRecord))) {
            throw new Error(`Web payload ${key} must contain message objects.`);
        }
    }
    for (const key of ['conversations', 'conversation', 'data', 'payload']) {
        if (key in value) {
            validateMessageCollections(value[key]);
        }
    }
};

export const parseWebPayload = async (
    value: unknown,
    fileName = 'import.json',
): Promise<PayloadConversationDraft[] | null> => {
    validateMessageCollections(value);
    const result = await parseWebChatFiles([{ content: JSON.stringify(value), name: fileName }]);
    if (result.errors.length > 0) {
        return null;
    }
    const collection = isRecord(value) && Array.isArray(value.conversations) ? value.conversations : value;
    if (
        Array.isArray(collection) &&
        collection.some((entry) => isRecord(entry) && !('role' in entry || 'sender' in entry || 'author' in entry)) &&
        result.conversations.length !== collection.length
    ) {
        throw new Error('Web payload contains unsupported or duplicate conversations.');
    }
    return result.conversations.map((conversation) => ({
        artifacts: conversation.artifacts,
        createdAtMs: conversation.createdAtMs,
        id: conversation.sourceConversationId ?? conversation.id,
        messages: normalizeCodexEvents(conversation.events).map((message) => ({
            ...message,
            id: message.id.replace(/^codex:/, 'web:'),
        })),
        metadata: { platform: conversation.platform },
        model: conversation.model,
        source: 'web',
        title: conversation.title,
        updatedAtMs: conversation.lastActiveAtMs,
    }));
};
