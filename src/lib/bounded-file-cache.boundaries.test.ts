import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBoundedFileCache } from './bounded-file-cache';

const roots: string[] = [];
const makeFile = async (content = 'source') => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-cache-boundary-'));
    roots.push(root);
    const file = path.join(root, 'source.txt');
    await Bun.write(file, content);
    return file;
};
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
};

describe('bounded cache failure and invalidation boundaries', () => {
    for (const invalidateAll of [false, true]) {
        it(`should not join an old in-flight load after ${invalidateAll ? 'global' : 'path'} invalidation`, async () => {
            const file = await makeFile();
            const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
            const started = deferred<void>();
            const oldResult = deferred<string>();
            const oldRead = cache.read(file, () => {
                started.resolve();
                return oldResult.promise;
            });
            await started.promise;
            cache.invalidate(invalidateAll ? undefined : file);
            const freshLoader = mock(async () => 'fresh');
            const newRead = cache.read(file, freshLoader);
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
                expect(await Promise.race([
                    newRead,
                    new Promise<never>((_resolve, reject) => {
                        timeout = setTimeout(() => reject(new Error('Fresh read joined the stale load')), 2000);
                    }),
                ])).toBe('fresh');
            } finally {
                clearTimeout(timeout);
                oldResult.resolve('stale');
                await Promise.allSettled([oldRead, newRead]);
            }
            expect(await oldRead).toBe('stale');
            expect(freshLoader).toHaveBeenCalledTimes(1);
            expect(await cache.read(file, async () => 'unexpected reload')).toBe('fresh');
        });
    }

    it('should release rejected loads so the next read can retry', async () => {
        const file = await makeFile();
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        const failure = new Error('transient read failure');
        await expect(cache.read(file, async () => { throw failure; })).rejects.toBe(failure);
        expect(await cache.read(file, async () => 'recovered')).toBe('recovered');
    });

    it('should not retain null results', async () => {
        const file = await makeFile();
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        expect(await cache.read(file, async () => null)).toBeNull();
        expect(await cache.read(file, async () => 'now available')).toBe('now available');
    });

    it('should return null without calling the loader for a missing file or directory', async () => {
        const file = await makeFile();
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        const loader = mock(async () => 'must not run');
        expect(await cache.read(path.dirname(file), loader)).toBeNull();
        expect(await cache.read(`${file}.missing`, loader)).toBeNull();
        expect(loader).not.toHaveBeenCalled();
    });

    it('should invalidate a retained value when its source file disappears', async () => {
        const file = await makeFile();
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        await cache.read(file, async () => 'old');
        await rm(file);
        expect(await cache.read(file, async () => 'unexpected')).toBeNull();
        await Bun.write(file, 'source');
        expect(await cache.read(file, async () => 'new')).toBe('new');
    });

    it('should distinguish fingerprints with different parser salts', async () => {
        const file = await makeFile();
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        expect(await cache.read(file, async () => 'v1', 'parser-v1')).toBe('v1');
        expect(await cache.read(file, async () => 'v2', 'parser-v2')).toBe('v2');
    });

    it('should detect same-size atomic replacements using file identity', async () => {
        const file = await makeFile('old');
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        const load = () => Bun.file(file).text();
        expect(await cache.read(file, load)).toBe('old');
        await Bun.write(`${file}.next`, 'new');
        await rename(`${file}.next`, file);
        expect(await cache.read(file, load)).toBe('new');
    });

    for (const limits of [
        { maxBytes: 0, maxEntries: 4 },
        { maxBytes: 1024, maxEntries: 0 },
        { maxBytes: 1, maxEntries: 4 },
    ]) {
        it(`should avoid retaining a nonempty source beyond limits ${JSON.stringify(limits)}`, async () => {
            const file = await makeFile();
            const cache = createBoundedFileCache<string>(limits);
            const loader = mock(async () => 'result');
            await cache.read(file, loader);
            await cache.read(file, loader);
            expect(loader).toHaveBeenCalledTimes(2);
        });
    }

    it('should reject negative, fractional and nonfinite resource ceilings', () => {
        for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => createBoundedFileCache({ maxBytes: value, maxEntries: 1 })).toThrow();
            expect(() => createBoundedFileCache({ maxBytes: 1, maxEntries: value })).toThrow();
        }
    });
});
