import { createHash, randomUUID } from 'node:crypto';
import { readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertPrivateRuntimeDirectorySafe, ensurePrivateRuntimeDirectory } from './private-runtime-directory';
import { resolveUiRuntimeConfig } from './runtime-config';

export const UI_CACHE_DIR_ENV = 'SPIRACHA_UI_CACHE_DIR';
const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), 'spiracha-ui-cache');
const CACHE_ENVELOPE_VERSION = 1;
const CACHE_PURGE_INTERVAL_MS = 60 * 1000;
const CACHE_KEY_PREFIX_MAX_LENGTH = 80;

type CacheEnvelope<T> = {
    value: T;
    version: number;
};

type CacheReadResult<T> = { hit: true; value: T } | { hit: false };

const inFlightCacheLoads = new Map<string, Promise<unknown>>();
const activeCachePathCounts = new Map<string, number>();
const pendingCachePathRemovals = new Set<string>();
let initializedCacheDir: string | null = null;
let cacheInvalidationGeneration = 0;
let lastCachePurgeAtMs = 0;

const removeInactiveCachePath = async (filePath: string): Promise<void> => {
    if (activeCachePathCounts.has(filePath)) {
        pendingCachePathRemovals.add(filePath);
        return;
    }
    await rm(filePath, { force: true });
};

const beginActiveCachePath = (filePath: string): void => {
    activeCachePathCounts.set(filePath, (activeCachePathCounts.get(filePath) ?? 0) + 1);
};

const finishActiveCachePath = async (filePath: string): Promise<void> => {
    const remainingCount = (activeCachePathCounts.get(filePath) ?? 1) - 1;
    if (remainingCount > 0) {
        activeCachePathCounts.set(filePath, remainingCount);
        return;
    }
    activeCachePathCounts.delete(filePath);
    if (pendingCachePathRemovals.delete(filePath)) {
        await rm(filePath, { force: true });
    }
};

export const pruneUiCacheEntries = async (
    cacheDir: string = getUiCacheDir(),
    maxAgeMs: number = resolveUiRuntimeConfig().cacheMaxAgeMs,
    maxBytes: number = resolveUiRuntimeConfig().cacheMaxBytes,
) => {
    await assertPrivateRuntimeDirectorySafe(cacheDir, 'cache');
    const cutoff = Date.now() - maxAgeMs;
    const entries = await readdir(cacheDir, { withFileTypes: true }).catch((error: unknown) => {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return [];
        }
        throw error;
    });
    const cacheFiles = (
        await Promise.all(
            entries
                .filter((entry) => entry.isFile())
                .map(async (entry) => {
                    const filePath = path.join(cacheDir, entry.name);
                    try {
                        const metadata = await stat(filePath);
                        return { filePath, mtimeMs: metadata.mtimeMs, name: entry.name, size: metadata.size };
                    } catch (error) {
                        if ((error as { code?: unknown }).code === 'ENOENT') {
                            return null;
                        }
                        throw error;
                    }
                }),
        )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const staleFiles = cacheFiles.filter((entry) => entry.name.endsWith('.json') && entry.mtimeMs < cutoff);
    await Promise.all(staleFiles.map((entry) => removeInactiveCachePath(entry.filePath)));

    const retainedCacheFiles = cacheFiles.filter((entry) => entry.mtimeMs >= cutoff && entry.name.endsWith('.json'));
    let retainedBytes = retainedCacheFiles.reduce((total, entry) => total + entry.size, 0);
    if (retainedBytes <= maxBytes) {
        return;
    }

    const retainedOldestFirst = retainedCacheFiles.sort(
        (left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name),
    );
    const oversizedFiles = [];
    for (const entry of retainedOldestFirst) {
        if (retainedBytes <= maxBytes) {
            break;
        }
        oversizedFiles.push(entry.filePath);
        retainedBytes -= entry.size;
    }
    await Promise.all(oversizedFiles.map(removeInactiveCachePath));
};

export const getUiCacheDir = () => process.env[UI_CACHE_DIR_ENV]?.trim() || DEFAULT_CACHE_DIR;

const refreshCacheDirectoryState = async (cacheDir: string) => {
    try {
        await assertPrivateRuntimeDirectorySafe(cacheDir, 'cache');
    } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT') {
            throw error;
        }
        initializedCacheDir = null;
    }
};

const ensureCacheDir = async () => {
    const cacheDir = getUiCacheDir();
    if (initializedCacheDir === cacheDir) {
        await refreshCacheDirectoryState(cacheDir);
    }

    if (initializedCacheDir !== cacheDir) {
        await ensurePrivateRuntimeDirectory(cacheDir, 'cache');
        initializedCacheDir = cacheDir;
    }
    const now = Date.now();
    if (now - lastCachePurgeAtMs >= CACHE_PURGE_INTERVAL_MS) {
        lastCachePurgeAtMs = now;
        void pruneUiCacheEntries(cacheDir).catch((error) => {
            console.warn('[spiracha:ui-cache] cache pruning failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }
};

const toCachePath = (key: string) => {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, CACHE_KEY_PREFIX_MAX_LENGTH);
    return path.join(getUiCacheDir(), `${safeKey}-${hashCacheKeyPartsIterable([key])}.json`);
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
    beginActiveCachePath(filePath);
    try {
        parsed = (await file.json()) as CacheEnvelope<T> | T;
    } catch {
        await rm(filePath, { force: true });
        return { hit: false };
    } finally {
        await finishActiveCachePath(filePath);
    }

    if (
        parsed &&
        typeof parsed === 'object' &&
        'version' in parsed &&
        (parsed as CacheEnvelope<T>).version === CACHE_ENVELOPE_VERSION &&
        'value' in parsed
    ) {
        const now = new Date();
        await utimes(filePath, now, now).catch(() => undefined);
        return { hit: true, value: (parsed as CacheEnvelope<T>).value };
    }

    await rm(filePath, { force: true });
    return { hit: false };
};

export const getCachedJson = async <T>(key: string): Promise<T | null> => {
    if (resolveUiRuntimeConfig().cacheBypass) {
        return null;
    }
    const cached = await readCachedJson<T>(key);
    return cached.hit ? cached.value : null;
};

export const setCachedJson = async <T>(key: string, value: T) => {
    if (resolveUiRuntimeConfig().cacheBypass) {
        return;
    }
    await ensureCacheDir();
    const filePath = toCachePath(key);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    const envelope: CacheEnvelope<T> = {
        value,
        version: CACHE_ENVELOPE_VERSION,
    };

    beginActiveCachePath(filePath);
    beginActiveCachePath(tempPath);
    try {
        await Bun.write(tempPath, JSON.stringify(envelope));
        await rename(tempPath, filePath);
    } finally {
        await rm(tempPath, { force: true });
        await finishActiveCachePath(tempPath);
        await finishActiveCachePath(filePath);
    }
};

export const withCachedJson = async <T>(key: string, loader: () => Promise<T>): Promise<T> => {
    if (resolveUiRuntimeConfig().cacheBypass) {
        return loader();
    }
    const inFlight = inFlightCacheLoads.get(key);
    if (inFlight) {
        return (await inFlight) as T;
    }

    const load = (async () => {
        const generation = cacheInvalidationGeneration;
        const cached = await readCachedJson<T>(key);
        if (cached.hit) {
            return cached.value;
        }

        const value = await loader();
        if (generation === cacheInvalidationGeneration) {
            await setCachedJson(key, value);
        }
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
    cacheInvalidationGeneration += 1;
    await ensureCacheDir();
    const cacheDir = getUiCacheDir();
    const entries = await readdir(cacheDir);

    await Promise.all(
        entries
            .filter((entry) => prefixes.some((prefix) => entry.startsWith(prefix)))
            .map((entry) => removeInactiveCachePath(path.join(cacheDir, entry))),
    );
};

export const clearUiCache = async (): Promise<void> => {
    cacheInvalidationGeneration += 1;
    await ensureCacheDir();
    const cacheDir = getUiCacheDir();
    const entries = await readdir(cacheDir);
    await Promise.all(entries.map((entry) => removeInactiveCachePath(path.join(cacheDir, entry))));
    lastCachePurgeAtMs = 0;
};
