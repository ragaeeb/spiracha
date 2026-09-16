import { expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBoundedFileCache } from './bounded-file-cache';

it('should retain a slow load when another file is invalidated', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cache-isolation-'));
    const filePath = path.join(root, 'slow.json');
    const cache = createBoundedFileCache<string>({ maxBytes: 1_024, maxEntries: 4 });
    let release: (value: string) => void = () => undefined;
    let started: () => void = () => undefined;
    const loading = new Promise<void>((resolve) => {
        started = resolve;
    });
    let loads = 0;
    try {
        await Bun.write(filePath, 'value');
        const pending = cache.read(filePath, () => {
            loads += 1;
            started();
            return new Promise<string>((resolve) => {
                release = resolve;
            });
        });
        await loading;
        cache.invalidate(path.join(root, 'unrelated.json'));
        release('value');
        expect(await pending).toBe('value');
        expect(
            await cache.read(filePath, async () => {
                loads += 1;
                return 'value';
            }),
        ).toBe('value');
        expect(loads).toBe(1);
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});

it('should not join or retain an invalidated in-flight load with an unchanged file fingerprint', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cache-inflight-generation-'));
    const filePath = path.join(root, 'session.json');
    const cache = createBoundedFileCache<string>({ maxBytes: 1_024, maxEntries: 4 });
    let release: (value: string) => void = () => undefined;
    let started: () => void = () => undefined;
    const loading = new Promise<void>((resolve) => {
        started = resolve;
    });
    try {
        await Bun.write(filePath, 'unchanged');
        const pending = cache.read(filePath, () => {
            started();
            return new Promise<string>((resolve) => {
                release = resolve;
            });
        });
        await loading;
        cache.invalidate(filePath);
        const fresh = cache.read(filePath, async () => 'fresh');
        // Let the second read finish stat() before settling the original load.
        await Bun.sleep(20);
        release('old');
        expect(await fresh).toBe('fresh');
        expect(await pending).toBe('old');
        expect(await cache.read(filePath, async () => 'unexpected')).toBe('fresh');
    } finally {
        release('old');
        await rm(root, { force: true, recursive: true });
    }
});

it('should observe invalidation performed synchronously inside a loader', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cache-loader-invalidation-'));
    const filePath = path.join(root, 'session.json');
    const cache = createBoundedFileCache<string>({ maxBytes: 1_024, maxEntries: 4 });
    let loads = 0;
    try {
        await Bun.write(filePath, 'value');
        const load = async () => {
            loads += 1;
            cache.invalidate(filePath);
            return 'value';
        };
        await cache.read(filePath, load);
        await cache.read(filePath, load);
        expect(loads).toBe(2);
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});
