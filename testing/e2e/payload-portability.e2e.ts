import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { payloadSourceFixtures } from '../../src/lib/conversation-payload-test-helpers';
import { expect, test } from './fixtures';

const payloadRoot = path.resolve('dist/payload');

for (const fixture of payloadSourceFixtures) {
    test(`should convert ${fixture.source} in a browser and Worker without Node or Bun globals`, async ({ context, page }) => {
        await context.route('**/audit-payload/**', async (route) => {
            const relative = new URL(route.request().url()).pathname.slice('/audit-payload/'.length);
            const target = path.resolve(payloadRoot, relative);
            if (!target.startsWith(`${payloadRoot}${path.sep}`) || !target.endsWith('.js')) {
                await route.abort();
                return;
            }
            await route.fulfill({ body: await readFile(target), contentType: 'text/javascript' });
        });
        await context.route('**/audit-payload-page', (route) => route.fulfill({
            body: '<!doctype html><title>Portable SDK test</title>',
            contentType: 'text/html',
        }));
        await page.goto('/audit-payload-page');
        const result = await page.evaluate(async (input) => {
            const moduleUrl = new URL('/audit-payload/conversation-payload.js', location.href).href;
            const sdk = await import(moduleUrl);
            const direct = await sdk.convertConversationPayload(input);
            const source = `
                import { convertConversationPayload } from ${JSON.stringify(moduleUrl)};
                self.onmessage = async ({ data }) => {
                    try {
                        const results = await convertConversationPayload(data);
                        const globals = ['Bun', 'Buffer', 'process'].filter((key) => key in self);
                        self.postMessage({ globals, results });
                    } catch (error) {
                        self.postMessage({ error: String(error) });
                    }
                };
            `;
            const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            const worker = new Worker(workerUrl, { type: 'module' });
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
                const fromWorker = await new Promise((resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('Portable Worker timed out')), 10000);
                    worker.onerror = (event) => reject(new Error(event.message));
                    worker.onmessage = (event) => resolve(event.data);
                    worker.postMessage(input);
                });
                return { direct, fromWorker, globals: ['Bun', 'Buffer', 'process'].filter((key) => key in globalThis) };
            } finally {
                clearTimeout(timeout);
                worker.terminate();
                URL.revokeObjectURL(workerUrl);
            }
        }, fixture);
        expect(result.globals).toEqual([]);
        expect(result.direct).toHaveLength(1);
        expect(result.direct[0].markdown).toContain('Consumer answer');
        expect(result.fromWorker).toEqual({ globals: [], results: result.direct });
    });
}
