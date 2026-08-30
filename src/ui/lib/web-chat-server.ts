import type { WebChatConversationSummary, WebChatFileInput, WebChatImportError } from '@spiracha/lib/web-chat';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

export const MAX_WEB_CHAT_FILES = 20;
export const MAX_WEB_CHAT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_WEB_CHAT_IMPORT_BYTES = 100 * 1024 * 1024;

const fileSchema = z.object({
    content: z.string().max(MAX_WEB_CHAT_FILE_BYTES),
    name: z.string().min(1).max(255),
});
const importSchema = z.object({
    files: z.array(fileSchema).min(1).max(MAX_WEB_CHAT_FILES),
});
const conversationSchema = z.object({
    conversationId: z.string().min(1),
});

const getTotalBytes = (files: WebChatFileInput[]): number =>
    files.reduce((total, file) => total + Buffer.byteLength(file.content), 0);

export const listWebChatsFn = createServerFn({ method: 'GET' }).handler(async () => {
    const { listImportedWebChats } = await import('@spiracha/lib/web-chat');
    return listImportedWebChats();
});

export const importWebChatsFn = createServerFn({ method: 'POST' })
    .validator(importSchema)
    .handler(
        async ({ data }): Promise<{ conversations: WebChatConversationSummary[]; errors: WebChatImportError[] }> => {
            if (data.files.length > MAX_WEB_CHAT_FILES) {
                throw new Error(`Import at most ${MAX_WEB_CHAT_FILES} files at once.`);
            }
            if (data.files.some((file) => Buffer.byteLength(file.content) > MAX_WEB_CHAT_FILE_BYTES)) {
                throw new Error('Each imported file must be 25 MB or smaller.');
            }
            if (getTotalBytes(data.files) > MAX_WEB_CHAT_IMPORT_BYTES) {
                throw new Error('The selected files exceed the 100 MB import limit.');
            }
            const { importWebChatFiles } = await import('@spiracha/lib/web-chat');
            const result = importWebChatFiles(data.files);
            return {
                conversations: result.conversations.map(({ events: _events, ...summary }) => summary),
                errors: result.errors,
            };
        },
    );

export const getWebChatFn = createServerFn({ method: 'GET' })
    .validator(conversationSchema)
    .handler(async ({ data }) => {
        const { getImportedWebChatSummary } = await import('@spiracha/lib/web-chat');
        const conversation = getImportedWebChatSummary(data.conversationId);
        if (!conversation) {
            throw new Error(`Imported web conversation not found: ${data.conversationId}`);
        }
        return conversation;
    });

export const getWebChatEventsFn = createServerFn({ method: 'GET' })
    .validator(conversationSchema)
    .handler(async ({ data }) => {
        const { getImportedWebChat } = await import('@spiracha/lib/web-chat');
        const conversation = getImportedWebChat(data.conversationId);
        if (!conversation) {
            throw new Error(`Imported web conversation not found: ${data.conversationId}`);
        }
        return conversation.events;
    });
