import { expect, it } from 'bun:test';
import { parseWebChatFiles } from './web-chat';

it('should bound batch parser admission and preserve conversation order', async () => {
    const content = JSON.stringify(
        Array.from({ length: 100 }, (_, index) => ({
            id: `conversation-${index}`,
            messages: [{ content: `Answer ${index}`, role: 'assistant' }],
        })),
    );
    const all = Promise.all;
    const allSettled = Promise.allSettled;
    let maxFanOut = 0;
    const measure = <T extends typeof all | typeof allSettled>(method: T): T =>
        new Proxy(method, {
            apply: (target, receiver, argumentsList) => {
                if (Array.isArray(argumentsList[0])) {
                    maxFanOut = Math.max(maxFanOut, argumentsList[0].length);
                }
                return Reflect.apply(target, receiver, argumentsList);
            },
        });
    try {
        Promise.all = measure(all);
        Promise.allSettled = measure(allSettled);
        const result = await parseWebChatFiles([{ content, name: 'batch.json' }]);
        expect(result.errors).toEqual([]);
        expect(result.conversations.map((item) => item.sourceConversationId)).toEqual(
            Array.from({ length: 100 }, (_, index) => `conversation-${index}`),
        );
        expect(maxFanOut).toBeLessThanOrEqual(4);
    } finally {
        Promise.all = all;
        Promise.allSettled = allSettled;
    }
});
