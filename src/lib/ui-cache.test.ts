import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCachedJson, invalidateCacheByPrefix, setCachedJson, withCachedJson } from './ui-cache';

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
});
