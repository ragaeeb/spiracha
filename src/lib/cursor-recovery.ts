import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { mapWithConcurrency } from './concurrency';
import {
    CURSOR_MAX_HISTORY_ENTRIES_BYTES,
    decodeCursorUri,
    findCursorTranscriptDirsForComposerIds,
    invalidateCursorDiscoveryCache,
    listCursorWorkspaceGroups,
    loadGlobalComposerHeadersStrict,
    withCursorReadonlyDb,
    withCursorWriteTransaction,
} from './cursor-db';
import {
    COMPOSER_DATA_KEY,
    COMPOSER_HEADERS_KEY,
    type CursorCleanupRetryPlan,
    type CursorFilesystemCleanupResult,
    type CursorPruneResult,
    type CursorRecoverResult,
    type CursorThreadSummary,
    type CursorWorkspaceBucket,
    type CursorWorkspaceGroup,
    getCursorGlobalDbPath,
    getCursorProjectsDir,
    getCursorWorkspaceStorageDir,
    resolveCursorUserDir,
} from './cursor-exporter-types';
import { assertSafeCursorComposerId, getCursorBubbleKeyRange, isCursorBubbleKeyForComposer } from './cursor-id';

type ComposerEntry = {
    composerId?: string;
    name?: string;
    type?: string;
    lastUpdatedAt?: number;
    createdAt?: number;
    totalLinesAdded?: number;
    workspaceIdentifier?: { id?: string; uri?: unknown } | null;
    [key: string]: unknown;
};

type ComposerData = {
    allComposers?: ComposerEntry[];
    selectedComposerIds?: string[];
    lastFocusedComposerIds?: string[];
    hasMigratedComposerData?: boolean;
    hasMigratedMultipleComposers?: boolean;
};

type BucketComposerDataSnapshot = {
    data: ComposerData;
    exists: boolean;
};

export const isCursorRunning = async (): Promise<boolean> => {
    const proc = Bun.spawn(['pgrep', '-x', 'Cursor'], { stderr: 'ignore', stdout: 'ignore' });
    return (await proc.exited) === 0;
};

const backupStamp = (): string => new Date().toISOString().replace(/[-:]/gu, '').replace(/\..+/u, '').replace('T', '-');
const CURSOR_BACKUP_RETENTION_COUNT = 5;
const CURSOR_SQLITE_BATCH_SIZE = 200;

const getCursorCleanupErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const isCursorSafetyError = (error: unknown): boolean =>
    error instanceof Error && error.message.startsWith('Unsafe Cursor');

const createCursorPruneResult = (composerIds: string[]): CursorPruneResult => ({
    bubblesDeleted: 0,
    cleanupFailures: [],
    composerDataDeleted: 0,
    composerIds,
    headersRemoved: 0,
    transcriptDirsRemoved: 0,
    transcriptDirsRemovedPaths: [],
    workspaceBucketsUpdated: 0,
});

const chunkValues = <T>(values: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
};

const writeRetainedCursorBackup = async (basePath: string, label: string, value: unknown): Promise<string> => {
    const directory = path.dirname(basePath);
    const filePrefix = `${path.basename(basePath)}.${label}.`;
    const backupPath = `${basePath}.${label}.${backupStamp()}.${randomUUID()}.json`;
    const temporaryPath = `${backupPath}.tmp-${randomUUID()}`;
    try {
        await Bun.write(temporaryPath, JSON.stringify(value));
        await rename(temporaryPath, backupPath);
    } finally {
        await rm(temporaryPath, { force: true });
    }
    const backups = (await readdir(directory))
        .filter((entry) => entry.startsWith(filePrefix) && entry.endsWith('.json'))
        .sort((left, right) => right.localeCompare(left));
    await Promise.all(
        backups.slice(CURSOR_BACKUP_RETENTION_COUNT).map((entry) => rm(path.join(directory, entry), { force: true })),
    );
    return backupPath;
};

// The Cursor global DB can be multiple gigabytes, so copying the whole file per operation is not
// viable. We instead write small, targeted JSON backups of only the data each operation touches.
const backupComposerHeaders = async (globalDbPath: string): Promise<string> => {
    const headers = withCursorReadonlyDb(
        globalDbPath,
        (db) => readJsonItem(db, COMPOSER_HEADERS_KEY) ?? { allComposers: [] },
    );

    return writeRetainedCursorBackup(globalDbPath, 'composerHeaders', headers);
};

const backupPrunedThreads = async (globalDbPath: string, composerIds: string[]): Promise<string> => {
    const dump = withCursorReadonlyDb(globalDbPath, (db) => {
        const hasModernHeaders = hasComposerHeadersTable(db);
        const bubblesByComposerId = readBubblesForComposerIds(db, composerIds);
        return {
            headers: readJsonItem<{ allComposers?: ComposerEntry[] }>(db, COMPOSER_HEADERS_KEY) ?? { allComposers: [] },
            threads: composerIds.map((composerId) => ({
                bubbles: bubblesByComposerId.get(composerId) ?? [],
                composerData: readJsonItemFromKv(db, `composerData:${composerId}`),
                composerId,
                modernComposerHeader: hasModernHeaders
                    ? db.query('SELECT * FROM composerHeaders WHERE composerId = ?').get(composerId)
                    : null,
            })),
        };
    });
    return writeRetainedCursorBackup(globalDbPath, 'prunedThreads', dump);
};

const readBubblesForComposerIds = (
    db: Database,
    composerIds: string[],
): Map<string, Array<{ key: string; value: string }>> => {
    const uniqueComposerIds = [...new Set(composerIds)];
    const bubblesByComposerId = new Map<string, Array<{ key: string; value: string }>>(
        uniqueComposerIds.map((composerId) => [composerId, []]),
    );
    for (const chunk of chunkValues(uniqueComposerIds, CURSOR_SQLITE_BATCH_SIZE)) {
        const query = chunk
            .map(() => 'SELECT ? AS composerId, key, value FROM cursorDiskKV WHERE key >= ? AND key < ?')
            .join(' UNION ALL ');
        const parameters = chunk.flatMap((composerId) => {
            const range = getCursorBubbleKeyRange(composerId);
            return [composerId, range.start, range.end];
        });
        const rows = db.query(query).all(...parameters) as Array<{
            composerId: string;
            key: string;
            value: string;
        }>;
        for (const row of rows) {
            if (isCursorBubbleKeyForComposer(row.key, row.value, row.composerId)) {
                bubblesByComposerId.get(row.composerId)?.push({ key: row.key, value: row.value });
            }
        }
    }
    return bubblesByComposerId;
};

const readJsonItemFromKv = (db: Database, key: string): unknown => {
    const row = db.query('SELECT value FROM cursorDiskKV WHERE key = ?').get(key) as { value?: string } | null;
    if (!row?.value) {
        return null;
    }

    try {
        return JSON.parse(row.value);
    } catch {
        return null;
    }
};

const readJsonItem = <T>(db: Database, key: string): T | null => {
    const row = db.query('SELECT value FROM ItemTable WHERE key = ?').get(key) as { value?: string } | null;
    if (!row?.value) {
        return null;
    }

    try {
        return JSON.parse(row.value) as T;
    } catch {
        return null;
    }
};

const writeJsonItem = (db: Database, key: string, value: unknown): void => {
    db.run(
        `INSERT INTO ItemTable (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, JSON.stringify(value)],
    );
};

const hasComposerHeadersTable = (db: Database): boolean =>
    Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'composerHeaders'").get());

const scoreComposer = (entry: ComposerEntry): number =>
    Number(Boolean(entry.name)) + Number(entry.lastUpdatedAt ?? 0) + Number(entry.totalLinesAdded ?? 0);

const mergeComposerEntries = (entries: ComposerEntry[]): ComposerEntry[] => {
    const byId = new Map<string, ComposerEntry>();
    for (const entry of entries) {
        const id = entry.composerId;
        if (!id) {
            continue;
        }

        const current = byId.get(id);
        if (!current || scoreComposer(entry) >= scoreComposer(current)) {
            byId.set(id, entry);
        }
    }

    return [...byId.values()].sort(
        (a, b) => Number(b.lastUpdatedAt ?? b.createdAt ?? 0) - Number(a.lastUpdatedAt ?? a.createdAt ?? 0),
    );
};

const buildWorkspaceIdentifier = (bucket: CursorWorkspaceBucket): { id: string; uri?: unknown } => {
    if (bucket.kind === 'folder' && bucket.folders[0]) {
        const folder = bucket.folders[0];
        return {
            id: bucket.bucketId,
            uri: {
                $mid: 1,
                external: `file://${folder}`,
                fsPath: folder,
                path: folder,
                scheme: 'file',
            },
        };
    }

    return { id: bucket.bucketId };
};

const composersForBucket = (bucket: CursorWorkspaceBucket, headers: ComposerEntry[]): ComposerEntry[] => {
    const fromBucket = withCursorReadonlyDb(
        bucket.dbPath,
        (db) => readJsonItem<ComposerData>(db, COMPOSER_DATA_KEY)?.allComposers ?? [],
    );

    const linked = headers.filter((header) => header.workspaceIdentifier?.id === bucket.bucketId);
    return mergeComposerEntries([...fromBucket, ...linked]);
};

const chooseTargetBucket = (
    group: CursorWorkspaceGroup,
): { target: CursorWorkspaceBucket; sources: CursorWorkspaceBucket[] } => {
    const ranked = [...group.buckets].sort((a, b) => b.mtimeMs - a.mtimeMs || b.dbSizeBytes - a.dbSizeBytes);
    const [target, ...sources] = ranked;
    return { sources, target: target! };
};

const relinkHeaders = (
    db: Database,
    composers: ComposerEntry[],
    sourceBucketIds: Set<string>,
    target: CursorWorkspaceBucket,
): { relinked: number; added: number } => {
    const data = readJsonItem<{ allComposers?: ComposerEntry[] }>(db, COMPOSER_HEADERS_KEY) ?? { allComposers: [] };
    const headers = data.allComposers ?? [];
    const byId = new Map(headers.filter((header) => header.composerId).map((header) => [header.composerId!, header]));
    const workspaceIdentifier = buildWorkspaceIdentifier(target);
    let relinked = 0;
    let added = 0;

    for (const composer of composers) {
        const id = composer.composerId;
        if (!id) {
            continue;
        }

        const existing = byId.get(id);
        if (existing) {
            const currentId = existing.workspaceIdentifier?.id;
            if (currentId !== target.bucketId && (currentId === undefined || sourceBucketIds.has(currentId))) {
                existing.workspaceIdentifier = workspaceIdentifier;
                relinked += 1;
            }
            continue;
        }

        headers.push({ ...composer, type: composer.type ?? 'head', workspaceIdentifier });
        byId.set(id, headers[headers.length - 1]!);
        added += 1;
    }

    if (relinked > 0 || added > 0) {
        headers.sort(
            (a, b) => Number(b.lastUpdatedAt ?? b.createdAt ?? 0) - Number(a.lastUpdatedAt ?? a.createdAt ?? 0),
        );
        writeJsonItem(db, COMPOSER_HEADERS_KEY, { allComposers: headers });
    }

    return { added, relinked };
};

const countBubbles = (db: Database, composerId: string): number => {
    const range = getCursorBubbleKeyRange(composerId);
    const rows = db
        .query('SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ?')
        .all(range.start, range.end) as Array<{ key: string; value: string }>;
    return rows.filter((row) => isCursorBubbleKeyForComposer(row.key, row.value, composerId)).length;
};

const countBubblesForComposerIds = (db: Database, composerIds: string[]): Map<string, number> => {
    const uniqueComposerIds = [...new Set(composerIds)];
    const counts = new Map<string, number>();
    for (const chunk of chunkValues(uniqueComposerIds, CURSOR_SQLITE_BATCH_SIZE)) {
        const query = chunk
            .map(() => 'SELECT ? AS composerId, key, value FROM cursorDiskKV WHERE key >= ? AND key < ?')
            .join(' UNION ALL ');
        const parameters = chunk.flatMap((composerId) => {
            const range = getCursorBubbleKeyRange(composerId);
            return [composerId, range.start, range.end];
        });
        const rows = db.query(query).all(...parameters) as Array<{
            composerId: string;
            key: string;
            value: string;
        }>;
        for (const row of rows) {
            if (isCursorBubbleKeyForComposer(row.key, row.value, row.composerId)) {
                counts.set(row.composerId, (counts.get(row.composerId) ?? 0) + 1);
            }
        }
    }
    return counts;
};

export const recoverCursorWorkspaceGroup = async (
    group: CursorWorkspaceGroup,
    apply: boolean,
    userDir = resolveCursorUserDir(),
): Promise<CursorRecoverResult> => {
    if (group.buckets.length === 0) {
        throw new Error(
            `"${group.label}" has no on-disk Cursor storage bucket to recover into. Its threads can still be exported or deleted.`,
        );
    }

    const globalDbPath = getCursorGlobalDbPath(userDir);
    const headers = loadGlobalComposerHeadersStrict(globalDbPath);
    const { target, sources } = chooseTargetBucket(group);
    const sourceBucketIds = new Set(sources.map((bucket) => bucket.bucketId));

    const merged = mergeComposerEntries([
        ...composersForBucket(target, headers),
        ...sources.flatMap((bucket) => composersForBucket(bucket, headers)),
    ]);

    if (!apply) {
        return buildRecoverResult(group, target, merged, globalDbPath, 0, merged.length);
    }

    const currentBucketData = readTargetBucketComposerData(target);
    await backupComposerHeaders(globalDbPath);
    await backupTargetBucketComposerData(target, currentBucketData);

    writeTargetBucketComposerData(target, buildTargetBucketComposerData(currentBucketData.data, merged));

    let relinked = 0;
    let added = 0;
    try {
        ({ relinked, added } = withCursorWriteTransaction(globalDbPath, (db) =>
            relinkHeaders(db, merged, sourceBucketIds, target),
        ));
    } catch (error) {
        try {
            writeTargetBucketComposerData(target, currentBucketData);
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Cursor recovery and bucket rollback both failed');
        }
        throw error;
    }
    invalidateCursorDiscoveryCache();

    return buildRecoverResult(group, target, merged, globalDbPath, relinked, added);
};

// Non-migrated workspaces read their thread list from the bucket's composer.composerData rather than
// the global headers, so we write the merged threads into the active bucket as well as relinking
// global headers. This mirrors what Cursor itself stores and makes recovery work for both layouts.
const readTargetBucketComposerData = (target: CursorWorkspaceBucket): BucketComposerDataSnapshot => {
    return withCursorReadonlyDb(target.dbPath, (db) => {
        const data = readJsonItem<ComposerData>(db, COMPOSER_DATA_KEY);
        return {
            data: data ?? {},
            exists: data !== null,
        };
    });
};

const backupTargetBucketComposerData = async (
    target: CursorWorkspaceBucket,
    snapshot: BucketComposerDataSnapshot,
): Promise<string> => {
    return writeRetainedCursorBackup(target.dbPath, 'composerData', snapshot);
};

const buildTargetBucketComposerData = (existing: ComposerData, merged: ComposerEntry[]): ComposerData => {
    const selectedIds = merged.map((entry) => entry.composerId).filter((value): value is string => Boolean(value));

    return {
        ...existing,
        allComposers: merged,
        hasMigratedComposerData: true,
        hasMigratedMultipleComposers: true,
        lastFocusedComposerIds: selectedIds.slice(0, 1),
        selectedComposerIds: selectedIds.slice(0, 5),
    };
};

const writeTargetBucketComposerData = (
    target: CursorWorkspaceBucket,
    snapshot: BucketComposerDataSnapshot | ComposerData,
): void => {
    withCursorWriteTransaction(target.dbPath, (db) => {
        if ('exists' in snapshot && !snapshot.exists) {
            db.run('DELETE FROM ItemTable WHERE key = ?', [COMPOSER_DATA_KEY]);
            return;
        }

        writeJsonItem(db, COMPOSER_DATA_KEY, 'exists' in snapshot ? snapshot.data : snapshot);
    });
};

const buildRecoverResult = (
    group: CursorWorkspaceGroup,
    target: CursorWorkspaceBucket,
    merged: ComposerEntry[],
    globalDbPath: string,
    relinked: number,
    added: number,
): CursorRecoverResult => {
    return withCursorReadonlyDb(globalDbPath, (db) => {
        return {
            activeBucketId: target.bucketId,
            addedHeaderCount: added,
            mergedThreadCount: merged.length,
            relinkedHeaderCount: relinked,
            threads: merged
                .filter((entry) => entry.composerId)
                .map((entry) => ({
                    bubbleCount: countBubbles(db, entry.composerId as string),
                    composerId: entry.composerId as string,
                    name: typeof entry.name === 'string' && entry.name ? entry.name : '(untitled)',
                })),
            workspaceKey: group.key,
        };
    });
};

const removeThreadFromBucket = (db: Database, composerIds: Set<string>): boolean => {
    const data = readJsonItem<ComposerData>(db, COMPOSER_DATA_KEY);
    if (!data?.allComposers?.length) {
        return false;
    }

    const before = data.allComposers.length;
    data.allComposers = data.allComposers.filter((entry) => !composerIds.has(entry.composerId ?? ''));
    if (data.allComposers.length === before) {
        return false;
    }

    data.selectedComposerIds = (data.selectedComposerIds ?? []).filter((id) => !composerIds.has(id));
    data.lastFocusedComposerIds = (data.lastFocusedComposerIds ?? []).filter((id) => !composerIds.has(id));
    writeJsonItem(db, COMPOSER_DATA_KEY, data);
    return true;
};

const pruneGlobalThread = (db: Database, composerId: string): { bubbles: number; composerData: number } => {
    const range = getCursorBubbleKeyRange(composerId);
    const rows = db
        .query('SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ?')
        .all(range.start, range.end) as Array<{ key: string; value: string }>;
    const bubbleKeys = rows
        .filter((row) => isCursorBubbleKeyForComposer(row.key, row.value, composerId))
        .map((row) => row.key);
    let bubbles = 0;
    for (const keys of chunkValues(bubbleKeys, CURSOR_SQLITE_BATCH_SIZE)) {
        if (keys.length === 0) {
            continue;
        }
        const placeholders = keys.map(() => '?').join(', ');
        bubbles += db.run(`DELETE FROM cursorDiskKV WHERE key IN (${placeholders})`, keys).changes ?? 0;
    }
    const headResult = db.run('DELETE FROM cursorDiskKV WHERE key = ?', [`composerData:${composerId}`]);
    return { bubbles, composerData: headResult.changes ?? 0 };
};

const removeThreadHeaders = (db: Database, composerIds: Set<string>): number => {
    const removedIds = new Set<string>();
    const data = readJsonItem<{ allComposers?: ComposerEntry[] }>(db, COMPOSER_HEADERS_KEY);
    if (data?.allComposers?.length) {
        data.allComposers = data.allComposers.filter((entry) => {
            const composerId = entry.composerId ?? '';
            if (composerIds.has(composerId)) {
                removedIds.add(composerId);
                return false;
            }
            return true;
        });
        if (removedIds.size > 0) {
            writeJsonItem(db, COMPOSER_HEADERS_KEY, data);
        }
    }

    if (hasComposerHeadersTable(db)) {
        for (const composerId of composerIds) {
            const result = db.run('DELETE FROM composerHeaders WHERE composerId = ?', [composerId]);
            if ((result.changes ?? 0) > 0) {
                removedIds.add(composerId);
            }
        }
    }

    return removedIds.size;
};

const validateCursorTranscriptDirs = async (
    threads: CursorThreadSummary[],
    userDir: string,
): Promise<Map<string, string>> => {
    const projectsDir = path.resolve(getCursorProjectsDir(userDir));
    const canonicalProjectsDir = await realpath(projectsDir).catch((error) => {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return projectsDir;
        }
        throw error;
    });
    const validatedTranscriptDirs = new Map<string, string>();
    for (const thread of threads) {
        assertSafeCursorComposerId(thread.composerId);
        for (const transcriptDir of thread.transcriptDirs) {
            const resolvedDir = path.resolve(transcriptDir);
            const resolvedProjectsDir = path.dirname(path.dirname(path.dirname(resolvedDir)));
            const canonicalDir = await realpath(resolvedDir).catch((error) => {
                if ((error as { code?: unknown }).code === 'ENOENT') {
                    return resolvedDir;
                }
                throw error;
            });
            const canonicalRelativePath = path.relative(canonicalProjectsDir, canonicalDir);
            const lexicalRelativePath = path.relative(projectsDir, resolvedDir);
            const expectedCanonicalDir = path.resolve(canonicalProjectsDir, lexicalRelativePath);
            if (
                path.basename(resolvedDir) !== thread.composerId ||
                path.basename(path.dirname(resolvedDir)) !== 'agent-transcripts' ||
                resolvedProjectsDir !== projectsDir ||
                canonicalDir !== expectedCanonicalDir ||
                !canonicalRelativePath ||
                canonicalRelativePath.startsWith(`..${path.sep}`) ||
                path.isAbsolute(canonicalRelativePath)
            ) {
                throw new Error(`Unsafe Cursor transcript directory: ${transcriptDir}`);
            }
            validatedTranscriptDirs.set(transcriptDir, canonicalDir);
        }
    }
    return validatedTranscriptDirs;
};

export type PruneCursorThreadsOptions = {
    apply: boolean;
    deleteSessionFiles: boolean;
};

export const pruneCursorThreads = async (
    threads: CursorThreadSummary[],
    options: PruneCursorThreadsOptions,
    userDir = resolveCursorUserDir(),
): Promise<CursorPruneResult> => {
    const discoveredTranscriptDirs = options.deleteSessionFiles
        ? await findCursorTranscriptDirsForComposerIds(
              threads.map((thread) => thread.composerId),
              userDir,
          )
        : new Map<string, string[]>();
    const effectiveThreads = options.deleteSessionFiles
        ? threads.map((thread) =>
              thread.transcriptDirs.length > 0
                  ? thread
                  : {
                        ...thread,
                        transcriptDirs: discoveredTranscriptDirs.get(thread.composerId) ?? [],
                    },
          )
        : threads;
    const validatedTranscriptDirs = options.deleteSessionFiles
        ? await validateCursorTranscriptDirs(effectiveThreads, userDir)
        : new Map<string, string>();

    const composerIds = new Set(effectiveThreads.map((thread) => thread.composerId));
    const globalDbPath = getCursorGlobalDbPath(userDir);
    const result = createCursorPruneResult([...composerIds]);

    if (composerIds.size === 0) {
        return result;
    }

    if (!options.apply) {
        result.bubblesDeleted = effectiveThreads.reduce((sum, thread) => sum + thread.bubbleCount, 0);
        result.composerDataDeleted = effectiveThreads.length;
        result.headersRemoved = effectiveThreads.length;
        result.transcriptDirsRemoved = options.deleteSessionFiles
            ? effectiveThreads.reduce((sum, thread) => sum + thread.transcriptDirs.length, 0)
            : 0;
        return result;
    }

    await backupPrunedThreads(globalDbPath, [...composerIds]);
    const bucketMutation = await pruneWorkspaceBuckets(composerIds, userDir);
    try {
        await pruneGlobalThreads(globalDbPath, effectiveThreads, composerIds, result);
    } catch (error) {
        try {
            await bucketMutation.rollback();
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Cursor deletion and bucket rollback both failed');
        }
        throw error;
    }
    result.workspaceBucketsUpdated = bucketMutation.updatedCount;
    if (options.deleteSessionFiles) {
        await pruneTranscriptDirs(effectiveThreads, result, validatedTranscriptDirs);
    }
    invalidateCursorDiscoveryCache();

    return result;
};

const pruneGlobalThreads = async (
    globalDbPath: string,
    threads: CursorThreadSummary[],
    composerIds: Set<string>,
    result: CursorPruneResult,
): Promise<void> => {
    const deleted = withCursorWriteTransaction(globalDbPath, (db) => {
        let bubblesDeleted = 0;
        let composerDataDeleted = 0;
        for (const thread of threads) {
            const deleted = pruneGlobalThread(db, thread.composerId);
            bubblesDeleted += deleted.bubbles;
            composerDataDeleted += deleted.composerData;
        }

        const headersRemoved = removeThreadHeaders(db, composerIds);
        return { bubblesDeleted, composerDataDeleted, headersRemoved };
    });
    result.bubblesDeleted += deleted.bubblesDeleted;
    result.composerDataDeleted += deleted.composerDataDeleted;
    result.headersRemoved = deleted.headersRemoved;
};

const restoreBucketComposerData = (dbPath: string, snapshot: BucketComposerDataSnapshot): void => {
    withCursorWriteTransaction(dbPath, (db) => {
        if (snapshot.exists) {
            writeJsonItem(db, COMPOSER_DATA_KEY, snapshot.data);
        } else {
            db.run('DELETE FROM ItemTable WHERE key = ?', [COMPOSER_DATA_KEY]);
        }
    });
};

const getCursorBucketDbPathsForComposerIds = (
    groups: CursorWorkspaceGroup[],
    composerIds: Set<string>,
): Set<string> => {
    const dbPaths = new Set<string>();
    for (const group of groups) {
        for (const bucket of group.buckets) {
            if (bucket.threadComposerIds.some((composerId) => composerIds.has(composerId))) {
                dbPaths.add(bucket.dbPath);
            }
        }
    }
    return dbPaths;
};

const pruneWorkspaceBuckets = async (composerIds: Set<string>, userDir: string) => {
    // A thread can live in multiple recovered buckets, so update every matching bucket without
    // opening unrelated workspace databases.
    const dbPaths = getCursorBucketDbPathsForComposerIds(
        await listCursorWorkspaceGroups(userDir, { strict: true }),
        composerIds,
    );

    const snapshots = new Map<string, BucketComposerDataSnapshot>();
    for (const dbPath of dbPaths) {
        const snapshot = withCursorReadonlyDb(dbPath, (db) => {
            const data = readJsonItem<ComposerData>(db, COMPOSER_DATA_KEY);
            return { data: data ?? {}, exists: data !== null };
        });
        snapshots.set(dbPath, snapshot);
    }

    const updatedPaths: string[] = [];
    const rollback = async () => {
        const rollbackFailures: unknown[] = [];
        for (const dbPath of [...updatedPaths].reverse()) {
            try {
                restoreBucketComposerData(dbPath, snapshots.get(dbPath)!);
            } catch (error) {
                rollbackFailures.push(error);
            }
        }
        if (rollbackFailures.length > 0) {
            throw new AggregateError(rollbackFailures, 'Failed to restore Cursor workspace buckets');
        }
    };

    try {
        for (const dbPath of dbPaths) {
            const updated = withCursorWriteTransaction(dbPath, (db) => removeThreadFromBucket(db, composerIds));
            if (updated) {
                updatedPaths.push(dbPath);
            }
        }
    } catch (error) {
        try {
            await rollback();
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Cursor bucket deletion and rollback both failed');
        }
        throw error;
    }

    return { rollback, updatedCount: updatedPaths.length };
};

const warnCursorRecoveryDataIssue = (event: string, details: Record<string, unknown>): void => {
    console.warn(`[spiracha:cursor] ${event}`, details);
};

const removeValidatedTranscriptDir = async (
    dir: string,
    result: CursorPruneResult,
    expectedCanonicalDir: string | undefined,
): Promise<boolean> => {
    if (!expectedCanonicalDir) {
        warnCursorRecoveryDataIssue('transcript_directory_not_prevalidated', { dir });
        result.cleanupFailures.push({
            error: 'Transcript directory was not prevalidated.',
            path: dir,
            phase: 'transcript_directory',
        });
        return false;
    }

    try {
        const currentCanonicalDir = await realpath(dir);
        if (currentCanonicalDir !== expectedCanonicalDir) {
            warnCursorRecoveryDataIssue('transcript_directory_changed', {
                currentCanonicalDir,
                dir,
                expectedCanonicalDir,
            });
            result.cleanupFailures.push({
                error: 'Transcript directory changed after validation.',
                path: dir,
                phase: 'transcript_directory',
            });
            return false;
        }
        await rm(expectedCanonicalDir, { force: true, recursive: true });
        return true;
    } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT' && (error as { code?: unknown }).code !== 'ENOTDIR') {
            warnCursorRecoveryDataIssue('transcript_directory_cleanup_failed', {
                dir,
                error: error instanceof Error ? error.message : String(error),
            });
            result.cleanupFailures.push({
                error: error instanceof Error ? error.message : String(error),
                path: dir,
                phase: 'transcript_directory',
            });
        }
        return false;
    }
};

const pruneTranscriptDirs = async (
    threads: CursorThreadSummary[],
    result: CursorPruneResult,
    validatedTranscriptDirs: Map<string, string>,
): Promise<void> => {
    const transcriptDirs = [...new Set(threads.flatMap((thread) => thread.transcriptDirs))];
    const removed = await mapWithConcurrency(transcriptDirs, 4, (dir) =>
        removeValidatedTranscriptDir(dir, result, validatedTranscriptDirs.get(dir)),
    );
    result.transcriptDirsRemoved = removed.filter(Boolean).length;
    result.transcriptDirsRemovedPaths = transcriptDirs.filter((_dir, index) => removed[index]);
};

type CursorBucketRoot = { exists: boolean; path: string };

const resolveCursorBucketRoot = async (
    bucket: CursorWorkspaceBucket,
    workspaceStorageDir: string,
    canonicalStorageDir: string,
): Promise<CursorBucketRoot> => {
    const bucketRoot = path.resolve(path.dirname(bucket.workspaceJsonPath));
    const dbRoot = path.resolve(path.dirname(bucket.dbPath));
    if (
        bucketRoot !== dbRoot ||
        path.dirname(bucketRoot) !== workspaceStorageDir ||
        path.basename(bucketRoot) !== bucket.bucketId
    ) {
        throw new Error(`Unsafe Cursor workspace bucket directory: ${bucketRoot}`);
    }

    const canonicalBucketRoot = await realpath(bucketRoot).catch((error) => {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    if (canonicalBucketRoot && path.dirname(canonicalBucketRoot) !== canonicalStorageDir) {
        throw new Error(`Unsafe Cursor workspace bucket directory: ${bucketRoot}`);
    }
    const expectedCanonicalBucketRoot = path.join(canonicalStorageDir, bucket.bucketId);
    if (canonicalBucketRoot && canonicalBucketRoot !== expectedCanonicalBucketRoot) {
        throw new Error(`Unsafe Cursor workspace bucket directory: ${bucketRoot}`);
    }

    return { exists: canonicalBucketRoot !== null, path: bucketRoot };
};

const removeCursorBucketRoot = async (
    bucketRoot: CursorBucketRoot,
    workspaceStorageDir: string,
    canonicalStorageDir: string,
): Promise<boolean> => {
    const currentStorageDir = await realpath(workspaceStorageDir).catch((error) => {
        if ((error as { code?: unknown }).code === 'ENOENT' || (error as { code?: unknown }).code === 'ENOTDIR') {
            return null;
        }
        throw error;
    });
    if (!currentStorageDir) {
        return false;
    }
    if (currentStorageDir !== canonicalStorageDir) {
        throw new Error(`Unsafe Cursor workspace storage directory: ${workspaceStorageDir}`);
    }
    const currentBucketRoot = await realpath(bucketRoot.path).catch((error) => {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    const expectedCanonicalBucketRoot = path.join(canonicalStorageDir, path.basename(bucketRoot.path));
    if (currentBucketRoot !== null && currentBucketRoot !== expectedCanonicalBucketRoot) {
        throw new Error(`Unsafe Cursor workspace bucket directory: ${bucketRoot.path}`);
    }
    await rm(expectedCanonicalBucketRoot, { force: true, recursive: true });
    return bucketRoot.exists;
};

const removeCursorBucketRoots = async (
    bucketRoots: CursorBucketRoot[],
    workspaceStorageDir: string,
    canonicalStorageDir: string,
): Promise<CursorFilesystemCleanupResult> => {
    const removedPaths: string[] = [];
    const cleanupFailures: CursorFilesystemCleanupResult['cleanupFailures'] = [];
    for (const bucketRoot of bucketRoots) {
        try {
            if (await removeCursorBucketRoot(bucketRoot, workspaceStorageDir, canonicalStorageDir)) {
                removedPaths.push(bucketRoot.path);
            }
        } catch (error) {
            if (isCursorSafetyError(error)) {
                throw error;
            }
            cleanupFailures.push({
                error: getCursorCleanupErrorMessage(error),
                path: bucketRoot.path,
                phase: 'workspace_buckets',
            });
        }
    }

    return { cleanupFailures, removedPaths };
};

export const deleteCursorWorkspaceBuckets = async (
    group: CursorWorkspaceGroup,
    userDir = resolveCursorUserDir(),
): Promise<CursorFilesystemCleanupResult> => {
    const workspaceStorageDir = path.resolve(getCursorWorkspaceStorageDir(userDir));
    try {
        const canonicalStorageDir = await realpath(workspaceStorageDir).catch((error) => {
            if ((error as { code?: unknown }).code === 'ENOENT') {
                return workspaceStorageDir;
            }
            throw error;
        });
        const bucketRoots = await Promise.all(
            group.buckets.map((bucket) => resolveCursorBucketRoot(bucket, workspaceStorageDir, canonicalStorageDir)),
        );
        return await removeCursorBucketRoots(bucketRoots, workspaceStorageDir, canonicalStorageDir);
    } finally {
        invalidateCursorDiscoveryCache();
    }
};

const normalizeCursorHistoryPath = (value: string): string | null => {
    const decoded = decodeCursorUri(value.trim());
    return decoded && path.isAbsolute(decoded) ? path.resolve(decoded) : null;
};

const isCursorHistoryEntryForWorkspace = (resource: string, folders: string[]): boolean => {
    const resourcePath = normalizeCursorHistoryPath(resource);
    if (!resourcePath) {
        return false;
    }

    return folders.some((folder) => {
        const relative = path.relative(folder, resourcePath);
        return (
            relative === '' ||
            (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
        );
    });
};

const assertSafeCursorHistoryEntryPath = (
    canonicalHistoryDir: string,
    entryPath: string,
    canonicalEntryPath: string,
): void => {
    const relativeEntryPath = path.relative(canonicalHistoryDir, canonicalEntryPath);
    if (
        relativeEntryPath === '' ||
        relativeEntryPath === '..' ||
        relativeEntryPath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeEntryPath) ||
        path.dirname(relativeEntryPath) !== '.'
    ) {
        throw new Error(`Unsafe Cursor history entry directory: ${entryPath}`);
    }
};

type CursorHistoryEntryReadResult = {
    cleanupFailure?: CursorFilesystemCleanupResult['cleanupFailures'][number];
    resource: string | null;
};

const readCursorHistoryEntryResource = async (
    entriesPath: string,
    failurePath = path.dirname(entriesPath),
): Promise<CursorHistoryEntryReadResult> => {
    let entriesStat: Awaited<ReturnType<typeof stat>>;
    try {
        entriesStat = await stat(entriesPath);
    } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT' && (error as { code?: unknown }).code !== 'ENOTDIR') {
            warnCursorRecoveryDataIssue('history_entries_stat_failed', {
                entriesPath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        if ((error as { code?: unknown }).code === 'ENOENT' || (error as { code?: unknown }).code === 'ENOTDIR') {
            return { resource: null };
        }
        return {
            cleanupFailure: {
                error: getCursorCleanupErrorMessage(error),
                path: failurePath,
                phase: 'workspace_history',
            },
            resource: null,
        };
    }
    if (entriesStat.size > CURSOR_MAX_HISTORY_ENTRIES_BYTES) {
        warnCursorRecoveryDataIssue('history_entries_oversized', {
            entriesPath,
            maxBytes: CURSOR_MAX_HISTORY_ENTRIES_BYTES,
            sizeBytes: entriesStat.size,
        });
        return {
            cleanupFailure: {
                error: `History entries exceed the ${CURSOR_MAX_HISTORY_ENTRIES_BYTES}-byte limit.`,
                path: failurePath,
                phase: 'workspace_history',
            },
            resource: null,
        };
    }

    try {
        const data = (await Bun.file(entriesPath).json()) as { resource?: unknown };
        return { resource: typeof data.resource === 'string' ? data.resource : null };
    } catch (error) {
        warnCursorRecoveryDataIssue('invalid_history_entries_json', {
            entriesPath,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            cleanupFailure: {
                error: `Could not parse Cursor history entries: ${getCursorCleanupErrorMessage(error)}`,
                path: failurePath,
                phase: 'workspace_history',
            },
            resource: null,
        };
    }
};

const removeCursorHistoryEntry = async (entryPath: string, canonicalEntryPath: string): Promise<boolean> => {
    const currentCanonicalEntryPath = await realpath(entryPath).catch((error) => {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    if (currentCanonicalEntryPath !== canonicalEntryPath) {
        warnCursorRecoveryDataIssue('history_entry_directory_changed', {
            canonicalEntryPath,
            currentCanonicalEntryPath,
            entryPath,
        });
        return false;
    }
    await rm(canonicalEntryPath, { force: true, recursive: true });
    return true;
};

type CursorHistoryCleanupEntryResult = {
    cleanupFailure?: CursorFilesystemCleanupResult['cleanupFailures'][number];
    removedPath?: string;
};

const cleanupCursorHistoryEntry = async (
    entryPath: string,
    historyDir: string,
    canonicalHistoryDir: string,
    folders: string[],
): Promise<CursorHistoryCleanupEntryResult> => {
    if (path.dirname(entryPath) !== historyDir) {
        throw new Error(`Unsafe Cursor history entry directory: ${entryPath}`);
    }
    const canonicalEntryPath = await realpath(entryPath).catch((error) => {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return null;
        }
        throw error;
    });
    if (!canonicalEntryPath) {
        return {};
    }

    assertSafeCursorHistoryEntryPath(canonicalHistoryDir, entryPath, canonicalEntryPath);
    const resourceResult = await readCursorHistoryEntryResource(
        path.join(canonicalEntryPath, 'entries.json'),
        entryPath,
    );
    if (resourceResult.cleanupFailure) {
        return { cleanupFailure: resourceResult.cleanupFailure };
    }
    if (!resourceResult.resource || !isCursorHistoryEntryForWorkspace(resourceResult.resource, folders)) {
        return {};
    }

    try {
        return (await removeCursorHistoryEntry(entryPath, canonicalEntryPath)) ? { removedPath: entryPath } : {};
    } catch (error) {
        if (isCursorSafetyError(error)) {
            throw error;
        }
        return {
            cleanupFailure: {
                error: getCursorCleanupErrorMessage(error),
                path: entryPath,
                phase: 'workspace_history',
            },
        };
    }
};

const getCursorHistoryEntryPaths = async (historyDir: string, requestedEntryPaths?: string[]): Promise<string[]> => {
    if (requestedEntryPaths) {
        return [...new Set(requestedEntryPaths.map((entryPath) => path.resolve(entryPath)))];
    }

    return (await readdir(historyDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(historyDir, entry.name));
};

const deleteCursorWorkspaceHistoryEntries = async (
    folders: string[],
    userDir: string,
    requestedEntryPaths?: string[],
): Promise<CursorFilesystemCleanupResult> => {
    const historyDir = path.resolve(path.join(userDir, 'History'));
    const removedPaths: string[] = [];
    const cleanupFailures: CursorFilesystemCleanupResult['cleanupFailures'] = [];

    try {
        if (folders.length === 0) {
            return { cleanupFailures, removedPaths };
        }

        const canonicalHistoryDir = await realpath(historyDir).catch((error) => {
            if ((error as { code?: unknown }).code === 'ENOENT') {
                return null;
            }
            throw error;
        });
        if (!canonicalHistoryDir) {
            return { cleanupFailures, removedPaths };
        }

        const entryPaths = await getCursorHistoryEntryPaths(historyDir, requestedEntryPaths);
        for (const entryPath of entryPaths) {
            const entryResult = await cleanupCursorHistoryEntry(entryPath, historyDir, canonicalHistoryDir, folders);
            if (entryResult.removedPath) {
                removedPaths.push(entryResult.removedPath);
            }
            if (entryResult.cleanupFailure) {
                cleanupFailures.push(entryResult.cleanupFailure);
            }
        }
    } finally {
        invalidateCursorDiscoveryCache();
    }

    return { cleanupFailures, removedPaths };
};

export const deleteCursorWorkspaceHistory = async (
    group: CursorWorkspaceGroup,
    userDir = resolveCursorUserDir(),
): Promise<CursorFilesystemCleanupResult> => {
    const folders = group.folders.map(normalizeCursorHistoryPath).filter((folder): folder is string => folder !== null);
    return deleteCursorWorkspaceHistoryEntries(folders, userDir);
};

const createCursorBucketForPath = (bucketPath: string): CursorWorkspaceBucket => {
    const resolvedPath = path.resolve(bucketPath);
    return {
        bucketId: path.basename(resolvedPath),
        composerCount: 0,
        dbPath: path.join(resolvedPath, 'state.vscdb'),
        dbSizeBytes: 0,
        folders: [],
        globalHeaderCount: 0,
        kind: 'folder',
        label: '',
        mtimeMs: 0,
        threadComposerIds: [],
        uri: '',
        workspaceJsonPath: path.join(resolvedPath, 'workspace.json'),
    };
};

const deleteCursorWorkspaceBucketPaths = async (
    bucketPaths: string[],
    userDir: string,
): Promise<CursorFilesystemCleanupResult> => {
    const workspaceStorageDir = path.resolve(getCursorWorkspaceStorageDir(userDir));
    try {
        const canonicalStorageDir = await realpath(workspaceStorageDir).catch((error) => {
            if ((error as { code?: unknown }).code === 'ENOENT') {
                return workspaceStorageDir;
            }
            throw error;
        });
        const bucketRoots = await Promise.all(
            [...new Set(bucketPaths)].map((bucketPath) =>
                resolveCursorBucketRoot(
                    createCursorBucketForPath(bucketPath),
                    workspaceStorageDir,
                    canonicalStorageDir,
                ),
            ),
        );
        return await removeCursorBucketRoots(bucketRoots, workspaceStorageDir, canonicalStorageDir);
    } finally {
        invalidateCursorDiscoveryCache();
    }
};

const createMinimalCursorThreadSummary = (composerId: string, transcriptDirs: string[]): CursorThreadSummary => ({
    bubbleBytes: 0,
    bubbleCount: 0,
    bucketId: null,
    composerId,
    createdAtMs: null,
    lastUpdatedAtMs: null,
    mode: null,
    model: null,
    name: '',
    parentComposerId: null,
    reasoningEffort: null,
    transcriptDirs,
    workspaceKey: '',
    workspaceLabel: '',
});

export const retryCursorWorkspaceCleanup = async (
    target: CursorCleanupRetryPlan,
    userDir = resolveCursorUserDir(),
): Promise<CursorPruneResult> => {
    const composerIds = [...new Set(target.composerIds)];
    for (const composerId of composerIds) {
        assertSafeCursorComposerId(composerId);
    }

    const result = createCursorPruneResult(composerIds);
    const transcriptThreads = composerIds.map((composerId) =>
        createMinimalCursorThreadSummary(
            composerId,
            target.transcriptDirs.filter((transcriptDir) => path.basename(path.resolve(transcriptDir)) === composerId),
        ),
    );
    if (target.transcriptDirs.length > 0) {
        const validatedTranscriptDirs = await validateCursorTranscriptDirs(transcriptThreads, userDir);
        await pruneTranscriptDirs(transcriptThreads, result, validatedTranscriptDirs);
    }

    const bucketCleanup = await deleteCursorWorkspaceBucketPaths(target.bucketPaths, userDir);
    result.workspaceBucketsRemovedPaths = bucketCleanup.removedPaths;
    result.cleanupFailures.push(...bucketCleanup.cleanupFailures);

    const folders = target.folders
        .map(normalizeCursorHistoryPath)
        .filter((folder): folder is string => folder !== null);
    const historyCleanup = await deleteCursorWorkspaceHistoryEntries(
        folders,
        userDir,
        target.historyPaths.length > 0 ? target.historyPaths : undefined,
    );
    result.workspaceHistoryRemovedPaths = historyCleanup.removedPaths;
    result.cleanupFailures.push(...historyCleanup.cleanupFailures);

    if (result.cleanupFailures.length > 0) {
        result.retryPlan = {
            bucketPaths: result.cleanupFailures
                .filter((failure) => failure.phase === 'workspace_buckets' && failure.path)
                .map((failure) => failure.path!),
            composerIds,
            folders: target.folders,
            historyPaths: result.cleanupFailures
                .filter((failure) => failure.phase === 'workspace_history' && failure.path)
                .map((failure) => failure.path!),
            transcriptDirs: result.cleanupFailures
                .filter((failure) => failure.phase === 'transcript_directory' && failure.path)
                .map((failure) => failure.path!),
            workspaceKey: target.workspaceKey,
        };
    }

    return result;
};

// Builds the minimal thread records needed to fully delete the given composer ids (bubble counts for
// reporting and the on-disk transcript directories to remove). Used by the UI delete actions.
export const collectCursorThreadsForDeletion = async (
    composerIds: string[],
    userDir = resolveCursorUserDir(),
): Promise<CursorThreadSummary[]> => {
    const globalDbPath = getCursorGlobalDbPath(userDir);
    const summaries: CursorThreadSummary[] = [];

    const bubbleCounts = withCursorReadonlyDb(globalDbPath, (db) => {
        for (const composerId of composerIds) {
            assertSafeCursorComposerId(composerId);
        }
        return countBubblesForComposerIds(db, composerIds);
    });
    const transcriptDirs = await findCursorTranscriptDirsForComposerIds(composerIds, userDir);
    for (const composerId of composerIds) {
        summaries.push({
            bubbleBytes: 0,
            bubbleCount: bubbleCounts.get(composerId) ?? 0,
            bucketId: null,
            composerId,
            createdAtMs: null,
            lastUpdatedAtMs: null,
            mode: null,
            model: null,
            name: '',
            parentComposerId: null,
            reasoningEffort: null,
            transcriptDirs: transcriptDirs.get(composerId) ?? [],
            workspaceKey: '',
            workspaceLabel: '',
        });
    }

    return summaries;
};
