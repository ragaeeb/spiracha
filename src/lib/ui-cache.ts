import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CACHE_DIR = path.join(os.tmpdir(), 'spiracha-ui-cache');
const CACHE_ENVELOPE_VERSION = 1;
const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHE_PURGE_INTERVAL_MS = 60 * 1000;

type CacheEnvelope<T> = {
    value: T;
    version: number;
};

type CacheReadResult<T> = { hit: true; value: T } | { hit: false };

const inFlightCacheLoads = new Map<string, Promise<unknown>>();
let lastCachePurgeAtMs = 0;

export const purgeStaleUiCacheEntries = async (
    cacheDir: string = CACHE_DIR,
    maxAgeMs: number = DEFAULT_CACHE_MAX_AGE_MS,
) => {
    const cutoff = Date.now() - maxAgeMs;
    const entries = await readdir(cacheDir, { withFileTypes: true }).catch((error: unknown) => {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return [];
        }
        throw error;
    });
    await Promise.all(
        entries
            .filter((entry) => entry.isFile())
            .map(async (entry) => {
                const filePath = path.join(cacheDir, entry.name);
                try {
                    if ((await stat(filePath)).mtimeMs < cutoff) {
                        await rm(filePath, { force: true });
                    }
                } catch (error) {
                    if ((error as { code?: unknown }).code !== 'ENOENT') {
                        throw error;
                    }
                }
            }),
    );
};

const ensureCacheDir = async () => {
    await mkdir(CACHE_DIR, { mode: 0o700, recursive: true });
    await chmod(CACHE_DIR, 0o700);
    const now = Date.now();
    if (now - lastCachePurgeAtMs >= CACHE_PURGE_INTERVAL_MS) {
        lastCachePurgeAtMs = now;
        void purgeStaleUiCacheEntries(CACHE_DIR).catch((error) => {
            console.warn('[spiracha:ui-cache] stale cache purge failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }
};

const toCachePath = (key: string) => {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/gu, '_');
    return path.join(CACHE_DIR, `${safeKey}-${hashCacheKeyPartsIterable([key])}.json`);
};

export const hashCacheKeyPartsIterable = (parts: Iterable<string>) => {
    const hash = createHash('sha1');
    for (const part of parts) {
        hash.update(String(part.length));
        hash.update(':');
        hash.update(part);
        hash.update(';');
    }

    return hash.digest('hex');
};

export const getFileFingerprint = async (filePath: string) => {
    const metadata = await stat(filePath);
    return `${filePath}:${metadata.size}:${metadata.mtimeMs}`;
};

const readCachedJson = async <T>(key: string): Promise<CacheReadResult<T>> => {
    await ensureCacheDir();
    const filePath = toCachePath(key);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return { hit: false };
    }

    let parsed: CacheEnvelope<T> | T;
    try {
        parsed = (await file.json()) as CacheEnvelope<T> | T;
    } catch {
        await rm(filePath, { force: true });
        return { hit: false };
    }

    if (
        parsed &&
        typeof parsed === 'object' &&
        'version' in parsed &&
        (parsed as CacheEnvelope<T>).version === CACHE_ENVELOPE_VERSION &&
        'value' in parsed
    ) {
        return { hit: true, value: (parsed as CacheEnvelope<T>).value };
    }

    await rm(filePath, { force: true });
    return { hit: false };
};

export const getCachedJson = async <T>(key: string): Promise<T | null> => {
    const cached = await readCachedJson<T>(key);
    return cached.hit ? cached.value : null;
};

export const setCachedJson = async <T>(key: string, value: T) => {
    await ensureCacheDir();
    const filePath = toCachePath(key);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    const envelope: CacheEnvelope<T> = {
        value,
        version: CACHE_ENVELOPE_VERSION,
    };

    try {
        await Bun.write(tempPath, JSON.stringify(envelope));
        await rename(tempPath, filePath);
    } finally {
        await rm(tempPath, { force: true });
    }
};

export const withCachedJson = async <T>(key: string, loader: () => Promise<T>): Promise<T> => {
    const inFlight = inFlightCacheLoads.get(key);
    if (inFlight) {
        return (await inFlight) as T;
    }

    const load = (async () => {
        const cached = await readCachedJson<T>(key);
        if (cached.hit) {
            return cached.value;
        }

        const value = await loader();
        await setCachedJson(key, value);
        return value;
    })();
    inFlightCacheLoads.set(key, load);

    try {
        return await load;
    } finally {
        if (inFlightCacheLoads.get(key) === load) {
            inFlightCacheLoads.delete(key);
        }
    }
};

export const invalidateCacheByPrefix = async (...prefixes: string[]) => {
    await ensureCacheDir();
    const entries = await readdir(CACHE_DIR);

    await Promise.all(
        entries
            .filter((entry) => prefixes.some((prefix) => entry.startsWith(prefix)))
            .map((entry) => rm(path.join(CACHE_DIR, entry), { force: true })),
    );
};
