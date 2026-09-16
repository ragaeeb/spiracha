import { describe, expect, it } from 'bun:test';
import { parseWebChatFiles } from './web-chat';

describe('Web import timestamp bounds', () => {
    it('should preserve message content when numeric timestamps cannot be represented as dates', async () => {
        for (const timestamp of [1e100, -1e100, '1e100', '-1e100']) {
            const result = await parseWebChatFiles([
                {
                    content: JSON.stringify({
                        messages: [{ content: 'Keep this answer', role: 'assistant', timestamp }],
                    }),
                    name: 'invalid-date.json',
                },
                {
                    content: JSON.stringify({ messages: [{ content: 'Other file', role: 'user' }] }),
                    name: 'valid.json',
                },
            ]);
            expect(result.errors).toEqual([]);
            expect(result.conversations).toHaveLength(2);
            expect(result.conversations[0]?.events[0]?.timestamp).toBeNull();
            expect(result.conversations[0]?.createdAtMs).toBeNull();
        }
    });
});
