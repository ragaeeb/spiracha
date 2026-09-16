import { expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mapWithConcurrency } from './concurrency';
import { pruneUiCacheEntries } from './ui-cache';
import { purgeStaleUiExports } from './ui-export-files';

for (const [name, prune] of [
    ['cache', pruneUiCacheEntries],
    ['exports', purgeStaleUiExports],
] as const) {
    it(`should bound ${name} maintenance fan-out and preserve byte-budget pruning`, async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), `maintenance-${name}-`));
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
            await mapWithConcurrency(
                Array.from({ length: 240 }, (_, index) => index),
                8,
                async (index) => {
                    await Bun.write(path.join(root, `${String(index).padStart(3, '0')}.json`), 'x');
                },
            );
            Promise.all = measure(all);
            Promise.allSettled = measure(allSettled);
            await prune(root, 60_000, 4);
            expect((await readdir(root)).length).toBe(4);
            expect(maxFanOut).toBeLessThanOrEqual(16);
        } finally {
            Promise.all = all;
            Promise.allSettled = allSettled;
            await rm(root, { force: true, recursive: true });
        }
    });
}
