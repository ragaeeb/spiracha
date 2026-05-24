import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CACHE_DIR = path.join(os.tmpdir(), 'spiracha-ui-cache');
const CACHE_ENVELOPE_VERSION = 1;

type CacheEnvelope<T> = {
    value: T;
    version: number;
};

const ensureCacheDir = async () => {
    await mkdir(CACHE_DIR, { recursive: true });
};

const toCachePath = (key: string) => {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/gu, '_');
    return path.join(CACHE_DIR, `${safeKey}-${hashCacheKeyParts(key)}.json`);
};

export const hashCacheKeyParts = (...parts: string[]) => {
    return createHash('sha1').update(parts.join('|')).digest('hex');
};

export const getFileFingerprint = async (filePath: string) => {
    const metadata = await stat(filePath);
    return `${filePath}:${metadata.size}:${metadata.mtimeMs}`;
};

export const getCachedJson = async <T>(key: string): Promise<T | null> => {
    await ensureCacheDir();
    const filePath = toCachePath(key);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return null;
    }

    let parsed: CacheEnvelope<T> | T;
    try {
        parsed = (await file.json()) as CacheEnvelope<T> | T;
    } catch {
        await rm(filePath, { force: true });
        return null;
    }

    if (
        parsed &&
        typeof parsed === 'object' &&
        'version' in parsed &&
        (parsed as CacheEnvelope<T>).version === CACHE_ENVELOPE_VERSION &&
        'value' in parsed
    ) {
        return (parsed as CacheEnvelope<T>).value;
    }

    return parsed as T;
};

export const setCachedJson = async <T>(key: string, value: T) => {
    await ensureCacheDir();
    const filePath = toCachePath(key);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    const envelope: CacheEnvelope<T> = {
        value,
        version: CACHE_ENVELOPE_VERSION,
    };

    await Bun.write(tempPath, JSON.stringify(envelope));
    await rename(tempPath, filePath);
};

export const withCachedJson = async <T>(key: string, loader: () => Promise<T>): Promise<T> => {
    const filePath = toCachePath(key);
    const existedBeforeRead = await Bun.file(filePath).exists();
    const cached = await getCachedJson<T>(key);
    if (cached !== null || (existedBeforeRead && (await Bun.file(filePath).exists()))) {
        return cached as T;
    }

    const value = await loader();
    await setCachedJson(key, value);
    return value;
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
