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

export const createBoundedFileCache = <T>({ maxBytes, maxEntries }: BoundedFileCacheOptions) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 0) {
        throw new Error('Bounded file cache limits must be non-negative safe integers.');
    }

    const entries = new Map<string, CacheEntry<T>>();
    const inFlight = new Map<string, Promise<T | null>>();
    let invalidationGeneration = 0;
    let retainedBytes = 0;

    const removeEntry = (filePath: string): void => {
        const existing = entries.get(filePath);
        if (existing) {
            retainedBytes -= existing.bytes;
            entries.delete(filePath);
        }
    };

    const invalidate = (filePath?: string): void => {
        invalidationGeneration += 1;
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
            return pending;
        }

        const generation = invalidationGeneration;
        const load = loader();
        inFlight.set(inFlightKey, load);
        try {
            const value = await load;
            if (value !== null && generation === invalidationGeneration) {
                retain(filePath, { bytes: metadata.size, fingerprint, value });
            }
            return value;
        } finally {
            if (inFlight.get(inFlightKey) === load) {
                inFlight.delete(inFlightKey);
            }
        }
    };

    return { invalidate, read };
};
