import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    getCachedJson,
    hashCacheKeyPartsIterable,
    invalidateCacheByPrefix,
    setCachedJson,
    withCachedJson,
} from './ui-cache';

const CACHE_DIR = path.join(os.tmpdir(), 'spiracha-ui-cache');
const getCacheFilePath = (key: string) => {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/gu, '_');
    const hash = createHash('sha1').update(key).digest('hex');
    return path.join(CACHE_DIR, `${safeKey}-${hash}.json`);
};

beforeEach(async () => {
    await rm(CACHE_DIR, { force: true, recursive: true });
});

afterEach(async () => {
    await rm(CACHE_DIR, { force: true, recursive: true });
});

describe('ui cache', () => {
    it('should cache literal null values without recomputing the loader', async () => {
        let loadCount = 0;

        const first = await withCachedJson<null>('null-value-test', async () => {
            loadCount += 1;
            return null;
        });
        const second = await withCachedJson<null>('null-value-test', async () => {
            loadCount += 1;
            return null;
        });

        expect(first).toBeNull();
        expect(second).toBeNull();
        expect(loadCount).toBe(1);
    });

    it('should create the cache directory with owner-only permissions', async () => {
        await setCachedJson('private-cache', { ok: true });

        expect((await stat(CACHE_DIR)).mode & 0o777).toBe(0o700);
    });

    it('should remove temporary files when the final cache rename fails', async () => {
        const key = 'rename-failure';
        await mkdir(getCacheFilePath(key), { recursive: true });

        await expect(setCachedJson(key, { ok: true })).rejects.toBeDefined();

        expect((await readdir(CACHE_DIR)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    });

    it('should coalesce concurrent cache misses for the same key', async () => {
        let loadCount = 0;
        let releaseLoader: () => void = () => {};
        const loaderCanFinish = new Promise<void>((resolve) => {
            releaseLoader = resolve;
        });

        const requests = Array.from({ length: 4 }, () =>
            withCachedJson('coalesced-entry', async () => {
                loadCount += 1;
                await loaderCanFinish;
                return { loadedBy: loadCount };
            }),
        );

        await Bun.sleep(1);
        expect(loadCount).toBe(1);
        releaseLoader();

        await expect(Promise.all(requests)).resolves.toEqual([
            { loadedBy: 1 },
            { loadedBy: 1 },
            { loadedBy: 1 },
            { loadedBy: 1 },
        ]);
        expect(loadCount).toBe(1);
    });

    it('should keep distinct cache keys separate when they contain path punctuation', async () => {
        await setCachedJson('thread-/tmp/a:b', { value: 'first' });
        await setCachedJson('thread-/tmp/a/b', { value: 'second' });

        expect(await getCachedJson<{ value: string }>('thread-/tmp/a:b')).toEqual({ value: 'first' });
        expect(await getCachedJson<{ value: string }>('thread-/tmp/a/b')).toEqual({ value: 'second' });
    });

    it('should invalidate only matching cache prefixes', async () => {
        await setCachedJson('analytics-one', { ok: true });
        await setCachedJson('thread-one', { ok: true });
        await setCachedJson('other-one', { ok: true });

        await invalidateCacheByPrefix('analytics-', 'thread-');

        expect(await getCachedJson('analytics-one')).toBeNull();
        expect(await getCachedJson('thread-one')).toBeNull();
        expect(await getCachedJson<{ ok: boolean }>('other-one')).toEqual({ ok: true });
    });

    it('should treat corrupted cache files as cache misses and rebuild them', async () => {
        const key = 'corrupted-entry';
        await Bun.write(getCacheFilePath(key), '{not-json');
        let loadCount = 0;

        const value = await withCachedJson(key, async () => {
            loadCount += 1;
            return { repaired: true };
        });

        expect(value).toEqual({ repaired: true });
        expect(loadCount).toBe(1);
        expect(await getCachedJson<{ repaired: boolean }>(key)).toEqual({ repaired: true });
    });

    it('should reject stale cache envelope versions', async () => {
        const key = 'stale-version-entry';
        await Bun.write(getCacheFilePath(key), JSON.stringify({ value: { stale: true }, version: 0 }));

        expect(await getCachedJson<{ stale: boolean }>(key)).toBeNull();
    });

    it('should hash iterable cache key parts without delimiter collisions', () => {
        expect(hashCacheKeyPartsIterable(['a|b'])).not.toBe(hashCacheKeyPartsIterable(['a', 'b']));
    });
});
