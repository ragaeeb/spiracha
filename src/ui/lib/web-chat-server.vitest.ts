import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        const serverFn = {
            handler: (callback: unknown) => callback,
            validator: () => serverFn,
        };
        return serverFn;
    },
}));

import {
    getWebChatEventsFn,
    getWebChatFn,
    importWebChatsFn,
    listWebChatsFn,
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

        await expect(importWebChatsFn({ data: { files } } as never)).rejects.toThrow(
            `Import at most ${MAX_WEB_CHAT_FILES} files at once.`,
        );
    });

    it('should reject missing parsed conversation ids', async () => {
        await expect(getWebChatFn({ data: { conversationId: 'missing-web-chat' } } as never)).rejects.toThrow(
            'Imported web conversation not found: missing-web-chat',
        );
    });
});
