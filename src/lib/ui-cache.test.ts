import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    getCachedJson,
    hashCacheKeyPartsIterable,
    invalidateCacheByPrefix,
    pruneUiCacheEntries,
    setCachedJson,
    withCachedJson,
} from './ui-cache';

const CACHE_DIR = path.join(os.tmpdir(), 'spiracha-ui-cache');
const CACHE_KEY_PREFIX_MAX_LENGTH = 80;
const getCacheFilePath = (key: string) => {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, CACHE_KEY_PREFIX_MAX_LENGTH);
    const hash = createHash('sha1').update(String(key.length)).update(':').update(key).update(';').digest('hex');
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

    it('should purge cache entries older than the retention window', async () => {
        await setCachedJson('stale-entry', { stale: true });
        await setCachedJson('fresh-entry', { fresh: true });
        const stalePath = getCacheFilePath('stale-entry');
        const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
        await utimes(stalePath, staleTime, staleTime);

        await pruneUiCacheEntries(CACHE_DIR, 24 * 60 * 60 * 1000);

        expect(await Bun.file(stalePath).exists()).toBe(false);
        expect(await Bun.file(getCacheFilePath('fresh-entry')).exists()).toBe(true);
    });

    it('should prune the oldest entries until the cache is within its size ceiling', async () => {
        await setCachedJson('oldest-entry', { payload: 'a'.repeat(100) });
        await setCachedJson('middle-entry', { payload: 'b'.repeat(100) });
        await setCachedJson('newest-entry', { payload: 'c'.repeat(100) });
        const oldestPath = getCacheFilePath('oldest-entry');
        const middlePath = getCacheFilePath('middle-entry');
        const newestPath = getCacheFilePath('newest-entry');
        const now = Date.now();
        await utimes(oldestPath, new Date(now - 3_000), new Date(now - 3_000));
        await utimes(middlePath, new Date(now - 2_000), new Date(now - 2_000));
        await utimes(newestPath, new Date(now - 1_000), new Date(now - 1_000));
        const newestSize = (await stat(newestPath)).size;

        await pruneUiCacheEntries(CACHE_DIR, Number.POSITIVE_INFINITY, newestSize);

        expect(await Bun.file(oldestPath).exists()).toBe(false);
        expect(await Bun.file(middlePath).exists()).toBe(false);
        expect(await Bun.file(newestPath).exists()).toBe(true);
    });

    it('should refresh accessed entries so hot cache data survives age eviction', async () => {
        await setCachedJson('cold-entry', { temperature: 'cold' });
        await setCachedJson('hot-entry', { temperature: 'hot' });
        const coldPath = getCacheFilePath('cold-entry');
        const hotPath = getCacheFilePath('hot-entry');
        const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
        await utimes(coldPath, staleTime, staleTime);
        await utimes(hotPath, staleTime, staleTime);

        expect(await getCachedJson<{ temperature: string }>('hot-entry')).toEqual({ temperature: 'hot' });
        await pruneUiCacheEntries(CACHE_DIR, 24 * 60 * 60 * 1000, Number.POSITIVE_INFINITY);

        expect(await Bun.file(coldPath).exists()).toBe(false);
        expect(await Bun.file(hotPath).exists()).toBe(true);
    });

    it('should not size-evict an in-progress temporary cache write', async () => {
        const activeTempPath = path.join(CACHE_DIR, 'active-write.tmp');
        await mkdir(CACHE_DIR, { recursive: true });
        await Bun.write(activeTempPath, 'in progress');

        await pruneUiCacheEntries(CACHE_DIR, Number.POSITIVE_INFINITY, 0);

        expect(await Bun.file(activeTempPath).exists()).toBe(true);
    });

    it('should not age-evict temporary cache writes', async () => {
        const activeTempPath = path.join(CACHE_DIR, 'old-active-write.tmp');
        await mkdir(CACHE_DIR, { recursive: true });
        await Bun.write(activeTempPath, 'in progress');
        const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
        await utimes(activeTempPath, staleTime, staleTime);

        await pruneUiCacheEntries(CACHE_DIR, 24 * 60 * 60 * 1000, Number.POSITIVE_INFINITY);

        expect(await Bun.file(activeTempPath).exists()).toBe(true);
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

    it('should not resurrect an entry invalidated during an in-flight load', async () => {
        let releaseLoader: () => void = () => {};
        const loaderCanFinish = new Promise<void>((resolve) => {
            releaseLoader = resolve;
        });
        const request = withCachedJson('thread-in-flight', async () => {
            await loaderCanFinish;
            return { stale: true };
        });
        await Bun.sleep(1);

        await invalidateCacheByPrefix('thread-');
        releaseLoader();

        await expect(request).resolves.toEqual({ stale: true });
        expect(await getCachedJson('thread-in-flight')).toBeNull();
    });

    it('should register coalescing before concurrent disk cache reads finish', async () => {
        let loadCount = 0;
        const requests = Array.from({ length: 20 }, () =>
            withCachedJson('cold-coalesced-entry', async () => {
                loadCount += 1;
                await Bun.sleep(5);
                return { loadedBy: loadCount };
            }),
        );

        await expect(Promise.all(requests)).resolves.toEqual(Array.from({ length: 20 }, () => ({ loadedBy: 1 })));
        expect(loadCount).toBe(1);
    });

    it('should keep distinct cache keys separate when they contain path punctuation', async () => {
        await setCachedJson('thread-/tmp/a:b', { value: 'first' });
        await setCachedJson('thread-/tmp/a/b', { value: 'second' });

        expect(await getCachedJson<{ value: string }>('thread-/tmp/a:b')).toEqual({ value: 'first' });
        expect(await getCachedJson<{ value: string }>('thread-/tmp/a/b')).toEqual({ value: 'second' });
    });

    it('should bound cache filenames for very long keys', async () => {
        const key = `thread-${'nested-path-'.repeat(100)}`;

        await setCachedJson(key, { ok: true });

        const [entry] = await readdir(CACHE_DIR);
        expect(Buffer.byteLength(entry ?? '')).toBeLessThanOrEqual(255);
        expect(await getCachedJson<{ ok: boolean }>(key)).toEqual({ ok: true });
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
