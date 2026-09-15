import { expect, it, spyOn } from 'bun:test';
import { parseWebChatFiles } from './web-chat';

const messageNode = (id: string, parent: string | null, children: string[] = []) => ({
    children,
    message: { author: { role: 'assistant' }, content: { parts: [id] }, id },
    parent,
});

it('should build a long selected mapping branch without repeated prepends', async () => {
    const mapping = Object.fromEntries(
        Array.from({ length: 1_000 }, (_, index) => [
            `n${index}`,
            messageNode(`n${index}`, index === 0 ? null : `n${index - 1}`, index < 999 ? [`n${index + 1}`] : []),
        ]),
    );
    const content = JSON.stringify({ conversation_id: 'chain', current_node: 'n999', mapping });
    const prepend = spyOn(Array.prototype, 'unshift');
    try {
        const { conversations } = await parseWebChatFiles([{ content, name: 'chain.json' }]);
        const events = conversations[0]!.events;
        expect(events).toHaveLength(1_000);
        expect(events[0]).toMatchObject({ kind: 'message', text: 'n0' });
        expect(events.at(-1)).toMatchObject({ kind: 'message', text: 'n999' });
        expect(prepend).not.toHaveBeenCalled();
    } finally {
        prepend.mockRestore();
    }
});

it('should preserve the last-leaf fallback and terminate parent cycles', async () => {
    const mapping = {
        first: messageNode('first', null),
        second: messageNode('second', 'third'),
        third: messageNode('third', 'second', ['second']),
    };
    const { conversations } = await parseWebChatFiles([
        { content: JSON.stringify({ current_node: 'missing', mapping }), name: 'fallback.json' },
    ]);
    expect(conversations[0]!.events.map((event) => (event.kind === 'message' ? event.text : ''))).toEqual([
        'third',
        'second',
    ]);
});
