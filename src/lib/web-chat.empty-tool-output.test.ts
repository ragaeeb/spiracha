import { describe, expect, it } from 'bun:test';
import { parseWebChatFiles } from './web-chat';

describe('Web empty tool outputs', () => {
    it('should retain successful empty tool results for call pairing', async () => {
        for (const content of ['', []]) {
            const result = await parseWebChatFiles([
                {
                    content: JSON.stringify({
                        messages: [
                            {
                                content: [{ id: 'quiet-call', input: {}, name: 'shell', type: 'tool_use' }],
                                role: 'assistant',
                            },
                            { content: [{ content, tool_use_id: 'quiet-call', type: 'tool_result' }], role: 'user' },
                            { content: 'Done', role: 'assistant' },
                        ],
                    }),
                    name: 'claude-quiet-tool.json',
                },
            ]);
            const outputs = result.conversations[0]?.events.filter((event) => event.kind === 'tool_output') ?? [];
            expect(outputs).toHaveLength(1);
            expect(outputs[0]?.callId).toBe('quiet-call');
            expect(outputs[0]?.outputText).toBe('');
        }
    });
});
