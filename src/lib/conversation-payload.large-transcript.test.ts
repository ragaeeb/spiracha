import { describe, expect, it } from 'bun:test';
import { parseGrokBotPayload } from './conversation-payload-grok-bot';
import { parseWebChatFiles } from './web-chat';

const count = 150_000;

describe('Large transcript timestamp bounds', () => {
    it('should compute Web timestamp bounds without spreading timestamps into a function call', async () => {
        const content = JSON.stringify({
            id: 'large-web-transcript',
            messages: Array.from({ length: count }, (_, index) => ({
                content: 'x',
                role: 'user',
                timestamp: 1_700_000_000_000 + index,
            })),
        });
        expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(25 * 1024 * 1024);
        const result = await parseWebChatFiles([{ content, name: 'large-web.json' }]);
        expect(result.conversations[0]?.createdAtMs).toBe(1_700_000_000_000);
        expect(result.conversations[0]?.lastActiveAtMs).toBe(1_700_000_000_000 + count - 1);
        expect(result.conversations[0]?.events).toHaveLength(count);
    });

    it('should compute native payload bounds without depending on the engine argument limit', () => {
        const entries = Array.from({ length: count }, (_, index) => ({
            content: 'x',
            kind: 'message',
            role: 'user',
            timestampMs: index,
        }));
        const value = { entries, id: 'large-native-transcript' };
        expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThanOrEqual(25 * 1024 * 1024);
        const result = parseGrokBotPayload(value);
        expect(result?.[0]?.updatedAtMs).toBe(count - 1);
        expect(result?.[0]?.messages).toHaveLength(count);
    });
    it('should traverse large tool argument arrays without spreading them into the search queue', async () => {
        const result = await parseWebChatFiles([
            {
                content: JSON.stringify({
                    id: 'large-tool-arguments',
                    messages: [
                        {
                            content: [
                                {
                                    input: { items: [...Array(count).fill('item'), { path: '/repo/needle' }] },
                                    name: 'inspect',
                                    type: 'tool_use',
                                },
                            ],
                            role: 'assistant',
                        },
                    ],
                }),
                name: 'large-tool.json',
            },
        ]);
        const event = result.conversations[0]?.events[0];
        expect(event?.kind).toBe('tool_call');
        if (event?.kind === 'tool_call') {
            expect(event.argumentsParseFailed).toBe(false);
            expect(event.command).toBe('/repo/needle');
        }
    });
});
