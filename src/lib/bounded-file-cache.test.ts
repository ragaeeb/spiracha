import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBoundedFileCache } from './bounded-file-cache';

describe('bounded file cache', () => {
    it('should coalesce concurrent reads and invalidate changed files', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-bounded-file-cache-'));
        const filePath = path.join(root, 'session.json');
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        let loads = 0;
        const load = async () => {
            loads += 1;
            return Bun.file(filePath).text();
        };

        try {
            await Bun.write(filePath, 'first');
            expect(await Promise.all([cache.read(filePath, load), cache.read(filePath, load)])).toEqual([
                'first',
                'first',
            ]);
            expect(loads).toBe(1);

            await Bun.write(filePath, 'second value');
            expect(await cache.read(filePath, load)).toBe('second value');
            expect(loads).toBe(2);

            cache.invalidate(filePath);
            expect(await cache.read(filePath, load)).toBe('second value');
            expect(loads).toBe(3);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('should evict least-recently-used entries within byte and entry ceilings', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-bounded-file-cache-lru-'));
        const firstPath = path.join(root, 'first.json');
        const secondPath = path.join(root, 'second.json');
        const cache = createBoundedFileCache<string>({ maxBytes: 10, maxEntries: 1 });
        const loads = new Map<string, number>();
        const read = (filePath: string) =>
            cache.read(filePath, async () => {
                loads.set(filePath, (loads.get(filePath) ?? 0) + 1);
                return Bun.file(filePath).text();
            });

        try {
            await Bun.write(firstPath, 'first');
            await Bun.write(secondPath, 'second');
            await read(firstPath);
            await read(secondPath);
            await read(firstPath);

            expect(loads.get(firstPath)).toBe(2);
            expect(loads.get(secondPath)).toBe(1);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('should not retain a load that was invalidated while in flight', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-bounded-file-cache-race-'));
        const filePath = path.join(root, 'session.json');
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        let releaseLoad: ((value: string) => void) | undefined;
        let markStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        let loads = 0;

        try {
            await Bun.write(filePath, 'source');
            const pending = cache.read(filePath, () => {
                loads += 1;
                markStarted?.();
                return new Promise<string>((resolve) => {
                    releaseLoad = resolve;
                });
            });
            await started;
            cache.invalidate(filePath);
            releaseLoad?.('stale');
            expect(await pending).toBe('stale');

            expect(
                await cache.read(filePath, async () => {
                    loads += 1;
                    return 'fresh';
                }),
            ).toBe('fresh');
            expect(loads).toBe(2);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('should retain concurrent loads for independent files', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-bounded-file-cache-parallel-'));
        const paths = [path.join(root, 'first.json'), path.join(root, 'second.json')];
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        const loads = new Map<string, number>();
        const read = (filePath: string) =>
            cache.read(filePath, async () => {
                loads.set(filePath, (loads.get(filePath) ?? 0) + 1);
                return Bun.file(filePath).text();
            });

        try {
            await Promise.all(paths.map((filePath, index) => Bun.write(filePath, `value-${index}`)));
            await Promise.all(paths.map(read));
            await Promise.all(paths.map(read));

            expect(paths.map((filePath) => loads.get(filePath))).toEqual([1, 1]);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
