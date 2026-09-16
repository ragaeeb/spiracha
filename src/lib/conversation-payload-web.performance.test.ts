import { expect, it } from 'bun:test';
import { parseWebPayload } from './conversation-payload-web';
import { parseWebChatFiles } from './web-chat';

it('should normalize an already decoded Web payload without a JSON round trip', async () => {
    const payload = {
        id: 'decoded',
        messages: [{ content: 'Answer', role: 'assistant' }],
        title: 'Original title',
    };
    const serialized = JSON.stringify(payload);
    const stringify = JSON.stringify;
    JSON.stringify = new Proxy(stringify, {
        apply: (target, receiver, argumentsList) => {
            if (argumentsList[0] === payload) {
                throw new Error('Decoded payload was serialized again.');
            }
            return Reflect.apply(target, receiver, argumentsList);
        },
    });
    try {
        const parsed = await parseWebPayload(payload, 'decoded.json');
        expect(parsed?.[0]).toMatchObject({ id: 'decoded', title: 'Original title' });
        expect(parsed?.[0]?.messages[0]?.text).toBe('Answer');
    } finally {
        JSON.stringify = stringify;
    }
    expect(JSON.stringify(payload)).toBe(serialized);
    expect((await parseWebChatFiles([{ content: serialized, name: 'decoded.json' }])).errors).toEqual([]);
});

it('should preserve unsupported and duplicate-batch validation', async () => {
    expect(await parseWebPayload({ unsupported: true })).toBeNull();
    await expect(parseWebPayload({ messages: ['invalid'] })).rejects.toThrow();
    const conversation = { id: 'duplicate', messages: [{ content: 'Answer', role: 'assistant' }] };
    await expect(parseWebPayload([conversation, conversation])).rejects.toThrow('duplicate');
});
