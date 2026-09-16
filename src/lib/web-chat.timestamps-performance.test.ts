import { expect, it } from 'bun:test';
import { parseWebChatFiles } from './web-chat';

it('should derive timestamps from a transcript larger than the argument-spread limit', async () => {
    const messages = Array.from({ length: 140_000 }, (_, index) => ({
        content: 'x',
        created_at: 1_700_000_000 + index,
        role: 'user',
    }));
    const { conversations } = await parseWebChatFiles([
        { content: JSON.stringify({ id: 'large-times', messages }), name: 'large.json' },
    ]);
    expect(conversations[0]).toMatchObject({
        createdAtMs: 1_700_000_000_000,
        lastActiveAtMs: 1_700_139_999_000,
        messageCount: 140_000,
    });
});
