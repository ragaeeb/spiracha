import { stat } from 'node:fs/promises';

type BoundedFileCacheOptions = {
    maxBytes: number;
    maxEntries: number;
};

type CacheEntry<T> = {
    bytes: number;
    fingerprint: string;
    value: T;
};

const getFingerprint = (metadata: NonNullable<Awaited<ReturnType<typeof stat>>>, salt: string): string =>
    `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}:${salt}`;

/**
 * Creates a fingerprint-keyed LRU cache budgeted by source file bytes, not decoded
 * value heap size. Coalesces concurrent loads of the same path/fingerprint; missing
 * or non-file inputs return null and oversized entries are returned without retention.
 * Invalidation marks matching in-flight loads so their results are not retained
 * and detaches them from the coalescing map, but does not cancel loaders or
 * prevent their existing callers from receiving those results. Unrelated paths
 * keep their in-flight identity. Fingerprinting before loading is not an
 * immutable read snapshot; callers needing stable content must add
 * source-specific identity/copy validation.
 */
export const createBoundedFileCache = <T>({ maxBytes, maxEntries }: BoundedFileCacheOptions) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 0) {
        throw new Error('Bounded file cache limits must be non-negative safe integers.');
    }

    const entries = new Map<string, CacheEntry<T>>();
    const inFlight = new Map<string, { filePath: string; invalidated: boolean; load: Promise<T | null> }>();
    let retainedBytes = 0;

    const removeEntry = (filePath: string): void => {
        const existing = entries.get(filePath);
        if (existing) {
            retainedBytes -= existing.bytes;
            entries.delete(filePath);
        }
    };

    const invalidate = (filePath?: string): void => {
        for (const [key, pending] of inFlight) {
            if (filePath === undefined || pending.filePath === filePath) {
                pending.invalidated = true;
                inFlight.delete(key);
            }
        }
        if (filePath === undefined) {
            entries.clear();
            retainedBytes = 0;
            return;
        }

        removeEntry(filePath);
    };

    const retain = (filePath: string, entry: CacheEntry<T>): void => {
        removeEntry(filePath);
        if (entry.bytes > maxBytes || maxEntries === 0) {
            return;
        }

        entries.set(filePath, entry);
        retainedBytes += entry.bytes;
        while (entries.size > maxEntries || retainedBytes > maxBytes) {
            const oldestPath = entries.keys().next().value;
            if (typeof oldestPath !== 'string') {
                break;
            }
            removeEntry(oldestPath);
        }
    };

    const read = async (filePath: string, loader: () => Promise<T | null>, fingerprintSalt = ''): Promise<T | null> => {
        const metadata = await stat(filePath).catch((error: unknown) => {
            if ((error as { code?: unknown }).code === 'ENOENT') {
                return null;
            }
            throw error;
        });
        if (!metadata?.isFile()) {
            invalidate(filePath);
            return null;
        }

        const fingerprint = getFingerprint(metadata, fingerprintSalt);
        const cached = entries.get(filePath);
        if (cached?.fingerprint === fingerprint) {
            entries.delete(filePath);
            entries.set(filePath, cached);
            return cached.value;
        }
        if (cached) {
            invalidate(filePath);
        }

        const inFlightKey = `${filePath}\0${fingerprint}`;
        const pending = inFlight.get(inFlightKey);
        if (pending) {
            return pending.load;
        }

        const entry = { filePath, invalidated: false, load: Promise.resolve().then(loader) };
        inFlight.set(inFlightKey, entry);
        try {
            const value = await entry.load;
            if (value !== null && !entry.invalidated) {
                retain(filePath, { bytes: metadata.size, fingerprint, value });
            }
            return value;
        } finally {
            if (inFlight.get(inFlightKey) === entry) {
                inFlight.delete(inFlightKey);
            }
        }
    };

    return { invalidate, read };
};
