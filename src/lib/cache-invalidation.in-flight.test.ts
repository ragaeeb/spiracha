import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBoundedFileCache } from './bounded-file-cache';
import { invalidateCacheByPrefix, withCachedJson } from './ui-cache';

const checkInvalidation = async (
    read: (loader: () => Promise<string>) => Promise<string | null>,
    invalidate: () => void | Promise<void>,
) => {
    let release: (value: string) => void = () => undefined;
    let started: () => void = () => undefined;
    const loading = new Promise<void>((resolve) => {
        started = resolve;
    });
    const pending = read(() => {
        started();
        return new Promise<string>((resolve) => {
            release = resolve;
        });
    });
    await loading;
    await invalidate();
    const fresh = read(async () => 'fresh');
    const timer = setTimeout(() => release('stale'), 100);
    try {
        expect(await fresh).toBe('fresh');
    } finally {
        clearTimeout(timer);
        release('stale');
        await pending;
    }
};

describe('reads started after cache invalidation', () => {
    it('should not reuse invalidated in-flight file-cache loads', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-file-invalidation-'));
        const filePath = path.join(root, 'source.json');
        const cache = createBoundedFileCache<string>({ maxBytes: 1024, maxEntries: 4 });
        try {
            await Bun.write(filePath, 'source');
            await checkInvalidation(
                (loader) => cache.read(filePath, loader),
                () => cache.invalidate(filePath),
            );
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('should not reuse invalidated in-flight UI-cache loads', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-ui-invalidation-'));
        const previous = process.env.SPIRACHA_UI_CACHE_DIR;
        process.env.SPIRACHA_UI_CACHE_DIR = root;
        try {
            await checkInvalidation(
                (loader) => withCachedJson('invalidation-race', loader),
                () => invalidateCacheByPrefix('invalidation-race'),
            );
        } finally {
            if (previous === undefined) {
                delete process.env.SPIRACHA_UI_CACHE_DIR;
            } else {
                process.env.SPIRACHA_UI_CACHE_DIR = previous;
            }
            await rm(root, { force: true, recursive: true });
        }
    });
});
