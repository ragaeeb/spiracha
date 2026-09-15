import { expect, test as base } from '@playwright/test';

export { expect };
export const test = base.extend<{ checkedPage: void; }>({
    checkedPage: [async ({ context, page, baseURL }, use) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const allowed = new URL(baseURL!);
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
            return local && url.port === allowed.port ? route.continue() : route.abort('blockedbyclient');
        });
        await use();
        expect(errors, 'Unexpected browser JavaScript / hydration errors').toEqual([]);
    }, { auto: true }],
});

export const chat = (id: string, title: string, answer = 'Browser fixture answer 会🙂') => ({
    conversation_id: id,
    current_node: 'assistant',
    default_model_slug: 'gpt-5',
    mapping: {
        assistant: {
            children: [],
            message: { author: { role: 'assistant' }, content: { parts: [answer] } },
            parent: 'user',
        },
        user: {
            children: ['assistant'],
            message: { author: { role: 'user' }, content: { parts: ['Browser fixture question'] } },
            parent: null,
        },
    },
    title,
});

export const jsonFile = (name: string, value: unknown) => ({
    buffer: Buffer.from(JSON.stringify(value)),
    mimeType: 'application/json',
    name,
});
