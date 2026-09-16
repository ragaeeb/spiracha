import { parse as parseWithSchema } from 'valibot';
import { describe, expect, it, vi } from 'vitest';

const { renderSourceSessionDownloadMock, renderSourceSessionsDownloadMock } = vi.hoisted(() => ({
    renderSourceSessionDownloadMock: vi.fn(async ({ content, sessionId }: { content: string; sessionId: string }) => ({
        content,
        fileName: `${sessionId}.md`,
        mimeType: 'text/markdown; charset=utf-8',
        mode: 'download' as const,
    })),
    renderSourceSessionsDownloadMock: vi.fn(),
}));

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        let parse: ((value: unknown) => unknown) | null = null;
        const serverFn = {
            handler: (callback: (input: { data: unknown }) => unknown) => async (input?: { data: unknown }) =>
                callback(parse && input ? { ...input, data: parse(input.data) } : (input as { data: unknown })),
            validator: (schema: Parameters<typeof parseWithSchema>[0]) => {
                parse = (value) => parseWithSchema(schema, value);
                return serverFn;
            },
        };
        return serverFn;
    },
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    deleteWebChatFn,
    deleteWebChatsFn,
    exportWebChatFn,
    getWebChatArtifactsFn,
    getWebChatEventsFn,
    getWebChatFn,
    importWebChatsFn,
    listWebChatsFn,
    MAX_WEB_CHAT_FILE_BYTES,
    MAX_WEB_CHAT_FILES,
} from './web-chat-server';

const exportedChat = {
    conversation_id: 'server-test-chat',
    current_node: 'assistant',
    default_model_slug: 'gpt-5',
    mapping: {
        assistant: {
            children: [],
            message: { author: { role: 'assistant' }, content: { parts: ['Answer'] } },
            parent: 'user',
        },
        user: {
            children: ['assistant'],
            message: { author: { role: 'user' }, content: { parts: ['Question'] } },
            parent: null,
        },
    },
    title: 'Server test',
};

describe('web chat server', () => {
    it('should load artifact bodies separately from import and list summaries', async () => {
        const content = '# Report\n\nOriginal Markdown\n';
        const result = await importWebChatsFn({
            data: {
                files: [
                    {
                        content: JSON.stringify({
                            ...exportedChat,
                            conversation_id: 'gemini-server-artifact',
                            default_model_slug: 'gemini-3-pro',
                            raw_payload: [
                                ['im_report', null, 'Report', null, content, [], null, null, [], 'im_report', 3],
                            ],
                        }),
                        name: 'gemini.json',
                    },
                ],
            },
        } as never);
        const summary = result.conversations[0]!;
        expect(summary).not.toHaveProperty('artifacts');
        expect(await getWebChatFn({ data: { conversationId: summary.id } } as never)).not.toHaveProperty('artifacts');
        expect(await listWebChatsFn()).toContainEqual(summary);
        expect(await getWebChatArtifactsFn({ data: { conversationId: summary.id } } as never)).toEqual([
            { content, id: 'im_report', title: 'Report' },
        ]);
        await expect(getWebChatArtifactsFn({ data: { conversationId: 'missing-artifact' } } as never)).rejects.toThrow(
            'Imported web conversation not found',
        );
    });
    it('should import summaries and expose the parsed detail by route id', async () => {
        const result = await importWebChatsFn({
            data: { files: [{ content: JSON.stringify(exportedChat), name: 'chatgpt.json' }] },
        } as never);

        expect(result.errors).toEqual([]);
        expect(result.conversations).toHaveLength(1);
        expect(result.conversations[0]).not.toHaveProperty('events');
        const id = result.conversations[0]!.id;
        const detail = await getWebChatFn({ data: { conversationId: id } } as never);
        expect(detail).not.toHaveProperty('events');
        expect(detail).toMatchObject({
            id,
            platform: 'ChatGPT',
            title: 'Server test',
        });
        expect(await getWebChatEventsFn({ data: { conversationId: id } } as never)).toHaveLength(2);
        expect(await listWebChatsFn()).toContainEqual(result.conversations[0]);
    });

    it('should surface parser failures without discarding valid imports', async () => {
        const result = await importWebChatsFn({
            data: {
                files: [
                    { content: JSON.stringify({ ...exportedChat, conversation_id: 'valid-too' }), name: 'valid.json' },
                    { content: 'invalid', name: 'broken.json' },
                ],
            },
        } as never);

        expect(result.conversations).toHaveLength(1);
        expect(result.errors).toEqual([{ fileName: 'broken.json', message: 'File is not valid JSON.' }]);
    });

    it('should reject imports beyond the bounded file count', async () => {
        const files = Array.from({ length: MAX_WEB_CHAT_FILES + 1 }, (_, index) => ({
            content: JSON.stringify({ ...exportedChat, conversation_id: `chat-${index}` }),
            name: `chat-${index}.json`,
        }));

        await expect(importWebChatsFn({ data: { files } } as never)).rejects.toThrow();
    });

    it('should reject malformed import payloads through the server validator', async () => {
        await expect(importWebChatsFn({ data: {} } as never)).rejects.toThrow();
        await expect(
            importWebChatsFn({ data: { files: [{ content: 42, name: 'invalid.json' }] } } as never),
        ).rejects.toThrow();
    });

    it('should accept a valid import payload through the server validator', async () => {
        await expect(
            importWebChatsFn({
                data: { files: [{ content: JSON.stringify(exportedChat), name: 'valid-schema.json' }] },
            } as never),
        ).resolves.toMatchObject({ errors: [] });
    });

    it('should validate imported file limits in UTF-8 bytes', async () => {
        const content = '€'.repeat(Math.floor(MAX_WEB_CHAT_FILE_BYTES / 3) + 1);

        await expect(
            importWebChatsFn({ data: { files: [{ content, name: 'oversized-unicode.json' }] } } as never),
        ).rejects.toThrow('Each imported file must be 25 MB or smaller.');
    });

    it('should reject missing parsed conversation ids', async () => {
        await expect(getWebChatFn({ data: { conversationId: 'missing-web-chat' } } as never)).rejects.toThrow(
            'Imported web conversation not found: missing-web-chat',
        );
    });

    it('should export and delete imported chats by parsed id', async () => {
        const imported = await importWebChatsFn({
            data: {
                files: [
                    {
                        content: JSON.stringify({ ...exportedChat, conversation_id: 'export-delete' }),
                        name: 'chat.json',
                    },
                ],
            },
        } as never);
        const id = imported.conversations[0]!.id;

        const download = await exportWebChatFn({
            data: {
                conversationId: id,
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: false,
            },
        } as never);
        expect(download).toMatchObject({ fileName: `${id}.md`, mode: 'download' });
        if (download.mode !== 'download') {
            throw new Error('expected inline web export');
        }
        expect(download.content).toContain('# Server test');
        expect(download.content).toContain(`parsed_id: "${id}"`);
        expect(download.content).toContain('## Assistant · Final answer · GPT 5');
        expect(renderSourceSessionDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ platform: 'web', sessionId: id, zipArchive: false }),
        );

        expect(await deleteWebChatsFn({ data: { conversationIds: [id, 'already-gone'] } } as never)).toEqual({
            deletedIds: [id],
            missingIds: ['already-gone'],
        });
        await expect(deleteWebChatFn({ data: { conversationId: id } } as never)).rejects.toThrow(
            `Imported web conversation not found: ${id}`,
        );
        await expect(getWebChatFn({ data: { conversationId: id } } as never)).rejects.toThrow(
            `Imported web conversation not found: ${id}`,
        );
        await expect(
            exportWebChatFn({
                data: { conversationId: 'server-test-chat', includeCommentary: false, outputFormat: 'md' },
            } as never),
        ).rejects.toThrow('Imported web conversation not found: server-test-chat');
    });
});
