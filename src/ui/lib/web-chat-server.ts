import type { WebChatConversationSummary, WebChatFileInput, WebChatImportError } from '@spiracha/lib/web-chat';
import { createServerFn } from '@tanstack/react-start';
import { array, boolean, check, maxLength, minLength, object, optional, picklist, pipe, string } from 'valibot';

import { MAX_WEB_CHAT_FILE_BYTES, MAX_WEB_CHAT_FILES, MAX_WEB_CHAT_IMPORT_BYTES } from './web-chat-limits';

export { MAX_WEB_CHAT_FILE_BYTES, MAX_WEB_CHAT_FILES, MAX_WEB_CHAT_IMPORT_BYTES } from './web-chat-limits';

const getTotalBytes = (files: WebChatFileInput[]): number =>
    files.reduce((total, file) => total + Buffer.byteLength(file.content), 0);

const fileSchema = object({
    content: pipe(
        string(),
        maxLength(MAX_WEB_CHAT_FILE_BYTES),
        check(
            (content) => Buffer.byteLength(content) <= MAX_WEB_CHAT_FILE_BYTES,
            'Each imported file must be 25 MB or smaller.',
        ),
    ),
    name: pipe(string(), minLength(1), maxLength(255)),
});
const importSchema = pipe(
    object({
        files: pipe(array(fileSchema), minLength(1), maxLength(MAX_WEB_CHAT_FILES)),
    }),
    check(
        ({ files }) => getTotalBytes(files) <= MAX_WEB_CHAT_IMPORT_BYTES,
        'The selected files exceed the 100 MB import limit.',
    ),
);
const conversationSchema = object({
    conversationId: pipe(string(), minLength(1)),
});

const exportOptionsSchema = {
    includeCommentary: optional(boolean(), false),
    includeMetadata: optional(boolean(), true),
    includeTools: optional(boolean(), true),
    outputFormat: optional(picklist(['md', 'txt']), 'md'),
    zipArchive: optional(boolean(), false),
};

const exportSchema = object({
    conversationId: pipe(string(), minLength(1)),
    ...exportOptionsSchema,
});

const exportChatsSchema = object({
    conversationIds: pipe(array(pipe(string(), minLength(1))), minLength(1), maxLength(200)),
    ...exportOptionsSchema,
    zipArchive: optional(boolean(), true),
});

const deleteChatsSchema = object({
    conversationIds: pipe(array(pipe(string(), minLength(1))), minLength(1), maxLength(200)),
});

const loadImportedWebChat = async (conversationId: string) => {
    const { getImportedWebChat } = await import('@spiracha/lib/web-chat');
    const conversation = getImportedWebChat(conversationId);
    if (!conversation) {
        throw new Error(`Imported web conversation not found: ${conversationId}`);
    }
    return conversation;
};

const renderLoadedWebChat = async (
    conversationId: string,
    options: {
        includeCommentary: boolean;
        includeMetadata: boolean;
        includeTools: boolean;
        outputFormat: 'md' | 'txt';
    },
) => {
    const { renderImportedWebChat } = await import('@spiracha/lib/web-chat');
    const conversation = await loadImportedWebChat(conversationId);
    const content = renderImportedWebChat(conversation, options);
    if (!content) {
        throw new Error(`Imported web conversation has no exportable content: ${conversationId}`);
    }
    return { content, conversation };
};

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
            const result = await importWebChatFiles(data.files);
            return {
                conversations: result.conversations.map(
                    ({ artifacts: _artifacts, events: _events, ...summary }) => summary,
                ),
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

export const getWebChatArtifactsFn = createServerFn({ method: 'GET' })
    .validator(conversationSchema)
    .handler(async ({ data }) => {
        const { getImportedWebChat } = await import('@spiracha/lib/web-chat');
        const conversation = getImportedWebChat(data.conversationId);
        if (!conversation) {
            throw new Error(`Imported web conversation not found: ${data.conversationId}`);
        }
        return conversation.artifacts;
    });

export const exportWebChatFn = createServerFn({ method: 'POST' })
    .validator(exportSchema)
    .handler(async ({ data }) => {
        const { content, conversation } = await renderLoadedWebChat(data.conversationId, data);
        const { renderSourceSessionDownload } = await import('./source-session-export-server');
        return renderSourceSessionDownload({
            content,
            cwd: null,
            fallbackBaseName: 'web-chat',
            outputFormat: data.outputFormat,
            platform: 'web',
            sessionId: conversation.id,
            updatedAtMs: conversation.lastActiveAtMs,
            zipArchive: data.zipArchive,
        });
    });

export const exportWebChatsFn = createServerFn({ method: 'POST' })
    .validator(exportChatsSchema)
    .handler(async ({ data }) => {
        const { renderSourceSessionsDownload } = await import('./source-session-export-server');
        const entries = [];
        for (const conversationId of data.conversationIds) {
            const { content, conversation } = await renderLoadedWebChat(conversationId, data);
            entries.push({
                content,
                cwd: null,
                fallbackBaseName: 'web-chat',
                fileBaseName: conversation.title || conversation.id,
                sessionId: conversation.id,
                updatedAtMs: conversation.lastActiveAtMs,
            });
        }
        return renderSourceSessionsDownload({
            entries,
            fallbackBaseName: 'web-chats',
            outputFormat: data.outputFormat,
            platform: 'web',
            zipArchive: data.zipArchive,
        });
    });

export const deleteWebChatFn = createServerFn({ method: 'POST' })
    .validator(conversationSchema)
    .handler(async ({ data }) => {
        const { removeImportedWebChats } = await import('@spiracha/lib/web-chat');
        const result = removeImportedWebChats([data.conversationId]);
        if (result.deletedIds.length === 0) {
            throw new Error(`Imported web conversation not found: ${data.conversationId}`);
        }
        return result;
    });

export const deleteWebChatsFn = createServerFn({ method: 'POST' })
    .validator(deleteChatsSchema)
    .handler(async ({ data }) => {
        const { removeImportedWebChats } = await import('@spiracha/lib/web-chat');
        return removeImportedWebChats(data.conversationIds);
    });
