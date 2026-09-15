import { expect, it } from 'bun:test';
import { parseWebChatFiles } from './web-chat';

it('should not encode a whole upload merely to account for its byte size', async () => {
    const content = JSON.stringify({ id: 'byte-count', messages: [{ content: 'x'.repeat(1_000_000), role: 'user' }] });
    const encode = TextEncoder.prototype.encode;
    let encodedCharacters = 0;
    TextEncoder.prototype.encode = new Proxy(encode, {
        apply: (target, receiver, argumentsList) => {
            encodedCharacters += argumentsList[0]?.length ?? 0;
            return Reflect.apply(target, receiver, argumentsList);
        },
    });
    try {
        expect((await parseWebChatFiles([{ content, name: 'bytes.json' }])).conversations).toHaveLength(1);
        expect(encodedCharacters).toBeLessThan(content.length / 4);
    } finally {
        TextEncoder.prototype.encode = encode;
    }
});
