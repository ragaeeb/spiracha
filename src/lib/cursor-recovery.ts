import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { mapWithConcurrency } from './concurrency';
import {
    decodeCursorUri,
    findCursorTranscriptDirsForComposerIds,
    invalidateCursorDiscoveryCache,
    listCursorWorkspaceGroups,
    loadGlobalComposerHeaders,
    openCursorReadonlyDb,
} from './cursor-db';
import {
    COMPOSER_DATA_KEY,
    COMPOSER_HEADERS_KEY,
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
import { assertSafeCursorComposerId, buildCursorBubbleKeyLikePattern, getCursorBubbleKeyRange } from './cursor-id';

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
    await Bun.write(backupPath, JSON.stringify(value));
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
    const db = openCursorReadonlyDb(globalDbPath);
    let headers: unknown;
    try {
        headers = readJsonItem(db, COMPOSER_HEADERS_KEY) ?? { allComposers: [] };
    } finally {
        db.close();
    }

    return writeRetainedCursorBackup(globalDbPath, 'composerHeaders', headers);
};

const backupPrunedThreads = async (globalDbPath: string, composerIds: string[]): Promise<string> => {
    const db = openCursorReadonlyDb(globalDbPath);
    try {
        const hasModernHeaders = hasComposerHeadersTable(db);
        const bubblesByComposerId = readBubblesForComposerIds(db, composerIds);
        const dump = composerIds.map((composerId) => ({
            bubbles: bubblesByComposerId.get(composerId) ?? [],
            composerData: readJsonItemFromKv(db, `composerData:${composerId}`),
            composerId,
            modernComposerHeader: hasModernHeaders
                ? db.query('SELECT * FROM composerHeaders WHERE composerId = ?').get(composerId)
                : null,
        }));
        return writeRetainedCursorBackup(globalDbPath, 'prunedThreads', dump);
    } finally {
        db.close();
    }
};

const readBubblesForComposerIds = (
    db: Database,
    composerIds: string[],
): Map<string, Array<{ key: string; value: string }>> => {
    const bubblesByComposerId = new Map<string, Array<{ key: string; value: string }>>(
        composerIds.map((composerId) => [composerId, []]),
    );
    for (const chunk of chunkValues(composerIds, CURSOR_SQLITE_BATCH_SIZE)) {
        const parameters: string[] = [];
        const query = chunk
            .map((composerId) => {
                const range = getCursorBubbleKeyRange(composerId);
                parameters.push(composerId, range.start, range.end);
                return 'SELECT ? AS composerId, key, value FROM cursorDiskKV WHERE key >= ? AND key < ?';
            })
            .join(' UNION ALL ');
        const rows = db.query(query).all(...parameters) as Array<{ composerId: string; key: string; value: string }>;
        for (const row of rows) {
            bubblesByComposerId.get(row.composerId)?.push({ key: row.key, value: row.value });
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
    let fromBucket: ComposerEntry[] = [];
    try {
        const db = openCursorReadonlyDb(bucket.dbPath);
        try {
            fromBucket = readJsonItem<ComposerData>(db, COMPOSER_DATA_KEY)?.allComposers ?? [];
        } finally {
            db.close();
        }
    } catch {
        fromBucket = [];
    }

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
    const row = db
        .query(`SELECT COUNT(*) AS count FROM cursorDiskKV WHERE key LIKE ? ESCAPE '\\'`)
        .get(buildCursorBubbleKeyLikePattern(composerId)) as { count: number };
    return row.count;
};

const countBubblesForComposerIds = (db: Database, composerIds: string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const chunk of chunkValues(composerIds, CURSOR_SQLITE_BATCH_SIZE)) {
        const parameters: string[] = [];
        const query = chunk
            .map((composerId) => {
                const range = getCursorBubbleKeyRange(composerId);
                parameters.push(composerId, range.start, range.end);
                return 'SELECT ? AS composerId, COUNT(*) AS count FROM cursorDiskKV WHERE key >= ? AND key < ?';
            })
            .join(' UNION ALL ');
        const rows = db.query(query).all(...parameters) as Array<{ composerId: string; count: number }>;
        for (const row of rows) {
            counts.set(row.composerId, row.count);
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
    const headers = loadGlobalComposerHeaders(globalDbPath);
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

    const db = new Database(globalDbPath);
    let committed = false;
    let relinked = 0;
    let added = 0;
    try {
        db.exec('BEGIN IMMEDIATE');
        writeTargetBucketComposerData(target, buildTargetBucketComposerData(currentBucketData.data, merged));
        ({ relinked, added } = relinkHeaders(db, merged, sourceBucketIds, target));
        db.exec('COMMIT');
        committed = true;
    } catch (error) {
        if (!committed) {
            try {
                db.exec('ROLLBACK');
            } catch {}

            try {
                writeTargetBucketComposerData(target, currentBucketData);
            } catch {}
        }

        throw error;
    } finally {
        db.close();
        invalidateCursorDiscoveryCache();
    }

    return buildRecoverResult(group, target, merged, globalDbPath, relinked, added);
};

// Non-migrated workspaces read their thread list from the bucket's composer.composerData rather than
// the global headers, so we write the merged threads into the active bucket as well as relinking
// global headers. This mirrors what Cursor itself stores and makes recovery work for both layouts.
const readTargetBucketComposerData = (target: CursorWorkspaceBucket): BucketComposerDataSnapshot => {
    const db = openCursorReadonlyDb(target.dbPath);
    try {
        const data = readJsonItem<ComposerData>(db, COMPOSER_DATA_KEY);
        return {
            data: data ?? {},
            exists: data !== null,
        };
    } finally {
        db.close();
    }
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
    const db = new Database(target.dbPath);
    try {
        if ('exists' in snapshot && !snapshot.exists) {
            db.run('DELETE FROM ItemTable WHERE key = ?', [COMPOSER_DATA_KEY]);
            return;
        }

        writeJsonItem(db, COMPOSER_DATA_KEY, 'exists' in snapshot ? snapshot.data : snapshot);
    } finally {
        db.close();
    }
};

const buildRecoverResult = (
    group: CursorWorkspaceGroup,
    target: CursorWorkspaceBucket,
    merged: ComposerEntry[],
    globalDbPath: string,
    relinked: number,
    added: number,
): CursorRecoverResult => {
    const db = openCursorReadonlyDb(globalDbPath);
    try {
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
    } finally {
        db.close();
    }
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
    const bubbleResult = db.run('DELETE FROM cursorDiskKV WHERE key >= ? AND key < ?', [range.start, range.end]);
    const headResult = db.run('DELETE FROM cursorDiskKV WHERE key = ?', [`composerData:${composerId}`]);
    return { bubbles: bubbleResult.changes ?? 0, composerData: headResult.changes ?? 0 };
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

export const pruneCursorThreads = async (
    threads: CursorThreadSummary[],
    apply: boolean,
    userDir = resolveCursorUserDir(),
): Promise<CursorPruneResult> => {
    const projectsDir = path.resolve(getCursorProjectsDir(userDir));
    const canonicalProjectsDir = await realpath(projectsDir).catch(() => projectsDir);
    for (const thread of threads) {
        assertSafeCursorComposerId(thread.composerId);
        for (const transcriptDir of thread.transcriptDirs) {
            const resolvedDir = path.resolve(transcriptDir);
            const resolvedProjectsDir = path.dirname(path.dirname(path.dirname(resolvedDir)));
            const canonicalDir = await realpath(resolvedDir).catch(() => resolvedDir);
            const canonicalRelativePath = path.relative(canonicalProjectsDir, canonicalDir);
            if (
                path.basename(resolvedDir) !== thread.composerId ||
                path.basename(path.dirname(resolvedDir)) !== 'agent-transcripts' ||
                resolvedProjectsDir !== projectsDir ||
                !canonicalRelativePath ||
                canonicalRelativePath.startsWith(`..${path.sep}`) ||
                path.isAbsolute(canonicalRelativePath)
            ) {
                throw new Error(`Unsafe Cursor transcript directory: ${transcriptDir}`);
            }
        }
    }

    const composerIds = new Set(threads.map((thread) => thread.composerId));
    const globalDbPath = getCursorGlobalDbPath(userDir);
    const result: CursorPruneResult = {
        bubblesDeleted: 0,
        composerDataDeleted: 0,
        composerIds: [...composerIds],
        headersRemoved: 0,
        transcriptDirsRemoved: 0,
        workspaceBucketsUpdated: 0,
    };

    if (composerIds.size === 0) {
        return result;
    }

    if (!apply) {
        result.bubblesDeleted = threads.reduce((sum, thread) => sum + thread.bubbleCount, 0);
        result.composerDataDeleted = threads.length;
        result.headersRemoved = threads.length;
        result.transcriptDirsRemoved = threads.reduce((sum, thread) => sum + thread.transcriptDirs.length, 0);
        return result;
    }

    await backupPrunedThreads(globalDbPath, [...composerIds]);
    const bucketMutation = await pruneWorkspaceBuckets(composerIds, userDir);
    try {
        await pruneGlobalThreads(globalDbPath, threads, composerIds, result);
    } catch (error) {
        try {
            await bucketMutation.rollback();
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Cursor deletion and bucket rollback both failed');
        }
        throw error;
    }
    result.workspaceBucketsUpdated = bucketMutation.updatedCount;
    await pruneTranscriptDirs(threads, result);
    invalidateCursorDiscoveryCache();

    return result;
};

const pruneGlobalThreads = async (
    globalDbPath: string,
    threads: CursorThreadSummary[],
    composerIds: Set<string>,
    result: CursorPruneResult,
): Promise<void> => {
    const db = new Database(globalDbPath);
    let transactionStarted = false;
    try {
        db.exec('PRAGMA busy_timeout = 5000');
        db.exec('BEGIN IMMEDIATE');
        transactionStarted = true;
        let bubblesDeleted = 0;
        let composerDataDeleted = 0;
        for (const thread of threads) {
            const deleted = pruneGlobalThread(db, thread.composerId);
            bubblesDeleted += deleted.bubbles;
            composerDataDeleted += deleted.composerData;
        }

        const headersRemoved = removeThreadHeaders(db, composerIds);
        db.exec('COMMIT');
        transactionStarted = false;
        result.bubblesDeleted += bubblesDeleted;
        result.composerDataDeleted += composerDataDeleted;
        result.headersRemoved = headersRemoved;
    } catch (error) {
        if (transactionStarted) {
            db.exec('ROLLBACK');
        }
        throw error;
    } finally {
        db.close();
    }
};

const restoreBucketComposerData = (dbPath: string, snapshot: BucketComposerDataSnapshot): void => {
    const db = new Database(dbPath);
    try {
        if (snapshot.exists) {
            writeJsonItem(db, COMPOSER_DATA_KEY, snapshot.data);
        } else {
            db.run('DELETE FROM ItemTable WHERE key = ?', [COMPOSER_DATA_KEY]);
        }
    } finally {
        db.close();
    }
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
    const dbPaths = getCursorBucketDbPathsForComposerIds(await listCursorWorkspaceGroups(userDir), composerIds);

    const snapshots = new Map<string, BucketComposerDataSnapshot>();
    for (const dbPath of dbPaths) {
        const db = openCursorReadonlyDb(dbPath);
        try {
            const data = readJsonItem<ComposerData>(db, COMPOSER_DATA_KEY);
            snapshots.set(dbPath, { data: data ?? {}, exists: data !== null });
        } finally {
            db.close();
        }
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
            const db = new Database(dbPath);
            try {
                if (removeThreadFromBucket(db, composerIds)) {
                    updatedPaths.push(dbPath);
                }
            } finally {
                db.close();
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

const pruneTranscriptDirs = async (threads: CursorThreadSummary[], result: CursorPruneResult): Promise<void> => {
    const transcriptDirs = threads.flatMap((thread) => thread.transcriptDirs);
    await mapWithConcurrency(transcriptDirs, 4, async (dir) => {
        await rm(dir, { force: true, recursive: true });
    });
    result.transcriptDirsRemoved = transcriptDirs.length;
};

export const deleteCursorWorkspaceBuckets = async (
    group: CursorWorkspaceGroup,
    userDir = resolveCursorUserDir(),
): Promise<number> => {
    const workspaceStorageDir = path.resolve(getCursorWorkspaceStorageDir(userDir));
    const canonicalStorageDir = await realpath(workspaceStorageDir).catch(() => workspaceStorageDir);
    const bucketRoots: Array<{ exists: boolean; path: string }> = [];

    for (const bucket of group.buckets) {
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

        bucketRoots.push({ exists: canonicalBucketRoot !== null, path: bucketRoot });
    }

    let removed = 0;
    try {
        for (const bucketRoot of bucketRoots) {
            await rm(bucketRoot.path, { force: true, recursive: true });
            removed += Number(bucketRoot.exists);
        }
    } finally {
        invalidateCursorDiscoveryCache();
    }

    return removed;
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

export const deleteCursorWorkspaceHistory = async (
    group: CursorWorkspaceGroup,
    userDir = resolveCursorUserDir(),
): Promise<number> => {
    const folders = group.folders.map(normalizeCursorHistoryPath).filter((folder): folder is string => folder !== null);
    const historyDir = path.resolve(path.join(userDir, 'History'));
    let removed = 0;

    try {
        if (folders.length === 0) {
            return 0;
        }

        const canonicalHistoryDir = await realpath(historyDir).catch((error) => {
            if ((error as { code?: unknown }).code === 'ENOENT') {
                return null;
            }
            throw error;
        });
        if (!canonicalHistoryDir) {
            return 0;
        }

        const entries = await readdir(historyDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const entryPath = path.join(historyDir, entry.name);
            const canonicalEntryPath = await realpath(entryPath).catch((error) => {
                if ((error as { code?: unknown }).code === 'ENOENT') {
                    return null;
                }
                throw error;
            });
            if (!canonicalEntryPath) {
                continue;
            }

            assertSafeCursorHistoryEntryPath(canonicalHistoryDir, entryPath, canonicalEntryPath);

            let data: { resource?: unknown };
            try {
                data = (await Bun.file(path.join(entryPath, 'entries.json')).json()) as { resource?: unknown };
            } catch {
                continue;
            }

            if (typeof data.resource !== 'string' || !isCursorHistoryEntryForWorkspace(data.resource, folders)) {
                continue;
            }

            await rm(entryPath, { force: true, recursive: true });
            removed += 1;
        }
    } finally {
        invalidateCursorDiscoveryCache();
    }

    return removed;
};

// Builds the minimal thread records needed to fully delete the given composer ids (bubble counts for
// reporting and the on-disk transcript directories to remove). Used by the UI delete actions.
export const collectCursorThreadsForDeletion = async (
    composerIds: string[],
    userDir = resolveCursorUserDir(),
): Promise<CursorThreadSummary[]> => {
    const globalDbPath = getCursorGlobalDbPath(userDir);
    const db = openCursorReadonlyDb(globalDbPath);
    const summaries: CursorThreadSummary[] = [];

    try {
        for (const composerId of composerIds) {
            assertSafeCursorComposerId(composerId);
        }
        const bubbleCounts = countBubblesForComposerIds(db, composerIds);
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
    } finally {
        db.close();
    }

    return summaries;
};
