import { expect, it } from 'bun:test';
import { parseWebChatFiles } from './web-chat';

const parseToolArguments = async (args: unknown) => {
    const { conversations } = await parseWebChatFiles([
        {
            content: JSON.stringify({
                conversation_id: 'arguments',
                current_node: 'tool',
                mapping: {
                    tool: {
                        message: {
                            author: { role: 'assistant' },
                            content: { content_type: 'code', text: JSON.stringify(args) },
                            id: 'call',
                            recipient: 'web.run',
                        },
                    },
                },
            }),
            name: 'tool.json',
        },
    ]);
    return conversations[0]!.events.find((event) => event.kind === 'tool_call');
};

it('should traverse a wide argument array without exceeding the function argument limit', async () => {
    const values: unknown[] = Array.from({ length: 150_000 }, () => null);
    values.push({ query: 'last label' });
    expect(await parseToolArguments({ values })).toMatchObject({
        argumentsParseFailed: false,
        command: 'last label',
    });
});

it('should preserve breadth-first label preference and object-key priority', async () => {
    expect(await parseToolArguments({ first: { deep: { query: 'deep' } }, second: { path: 'shallow' } })).toMatchObject(
        { command: 'shallow' },
    );
    expect(await parseToolArguments({ path: 'path', query: 'query' })).toMatchObject({ command: 'query' });
});
