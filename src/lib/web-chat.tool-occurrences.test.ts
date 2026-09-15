import { describe, expect, it } from 'bun:test';
import { parseWebChatFiles } from './web-chat';

const parseCalls = async (messages: unknown[]) => {
    const result = await parseWebChatFiles([{ content: JSON.stringify({ messages }), name: 'claude-tools.json' }]);
    return result.conversations[0]?.events.filter((event) => event.kind === 'tool_call') ?? [];
};

const tool = { input: { command: 'pwd' }, name: 'shell', type: 'tool_use' };

describe('Web tool occurrence identity', () => {
    it('should retain identical ID-less calls in separate turns', async () => {
        const calls = await parseCalls([
            { content: [tool], role: 'assistant' },
            { content: 'Again', role: 'user' },
            { content: [tool], role: 'assistant' },
        ]);
        expect(calls).toHaveLength(2);
    });

    it('should retain identical ID-less calls in the same turn', async () => {
        expect(await parseCalls([{ content: [tool, tool], role: 'assistant' }])).toHaveLength(2);
    });

    it('should still deduplicate repeated representations of an explicitly identified call', async () => {
        const identified = { ...tool, id: 'call-1' };
        expect(await parseCalls([{ content: [identified, identified], role: 'assistant' }])).toHaveLength(1);
    });
});
