import { Database } from 'bun:sqlite';
import { rm } from 'node:fs/promises';
import {
    findCursorTranscriptDirs,
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
    resolveCursorUserDir,
} from './cursor-exporter-types';

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

export const isCursorRunning = async (): Promise<boolean> => {
    const proc = Bun.spawn(['pgrep', '-x', 'Cursor'], { stderr: 'ignore', stdout: 'ignore' });
    return (await proc.exited) === 0;
};

const backupStamp = (): string => new Date().toISOString().replace(/[-:]/gu, '').replace(/\..+/u, '').replace('T', '-');

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

    const backupPath = `${globalDbPath}.composerHeaders.${backupStamp()}.json`;
    await Bun.write(backupPath, JSON.stringify(headers));
    return backupPath;
};

const backupPrunedThreads = async (globalDbPath: string, composerIds: string[]): Promise<string> => {
    const db = openCursorReadonlyDb(globalDbPath);
    try {
        const dump = composerIds.map((composerId) => ({
            bubbles: db.query('SELECT key, value FROM cursorDiskKV WHERE key LIKE ?').all(`bubbleId:${composerId}:%`),
            composerData: readJsonItemFromKv(db, `composerData:${composerId}`),
            composerId,
        }));
        const backupPath = `${globalDbPath}.prunedThreads.${backupStamp()}.json`;
        await Bun.write(backupPath, JSON.stringify(dump));
        return backupPath;
    } finally {
        db.close();
    }
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
        .query('SELECT COUNT(*) AS count FROM cursorDiskKV WHERE key LIKE ?')
        .get(`bubbleId:${composerId}:%`) as { count: number };
    return row.count;
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

    await backupComposerHeaders(globalDbPath);
    writeTargetBucketComposerData(target, merged);

    const db = new Database(globalDbPath);
    try {
        const { relinked, added } = relinkHeaders(db, merged, sourceBucketIds, target);
        return buildRecoverResult(group, target, merged, globalDbPath, relinked, added);
    } finally {
        db.close();
        invalidateCursorDiscoveryCache();
    }
};

// Non-migrated workspaces read their thread list from the bucket's composer.composerData rather than
// the global headers, so we write the merged threads into the active bucket as well as relinking
// global headers. This mirrors what Cursor itself stores and makes recovery work for both layouts.
const writeTargetBucketComposerData = (target: CursorWorkspaceBucket, merged: ComposerEntry[]): void => {
    const db = new Database(target.dbPath);
    try {
        const existing = readJsonItem<ComposerData>(db, COMPOSER_DATA_KEY) ?? {};
        const selectedIds = merged.map((entry) => entry.composerId).filter((value): value is string => Boolean(value));

        writeJsonItem(db, COMPOSER_DATA_KEY, {
            ...existing,
            allComposers: merged,
            hasMigratedComposerData: true,
            hasMigratedMultipleComposers: true,
            lastFocusedComposerIds: selectedIds.slice(0, 1),
            selectedComposerIds: selectedIds.slice(0, 5),
        });
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
    const bubbleResult = db.run('DELETE FROM cursorDiskKV WHERE key LIKE ?', [`bubbleId:${composerId}:%`]);
    const headResult = db.run('DELETE FROM cursorDiskKV WHERE key = ?', [`composerData:${composerId}`]);
    return { bubbles: bubbleResult.changes ?? 0, composerData: headResult.changes ?? 0 };
};

const removeThreadHeaders = (db: Database, composerIds: Set<string>): number => {
    const data = readJsonItem<{ allComposers?: ComposerEntry[] }>(db, COMPOSER_HEADERS_KEY);
    if (!data?.allComposers?.length) {
        return 0;
    }

    const before = data.allComposers.length;
    data.allComposers = data.allComposers.filter((entry) => !composerIds.has(entry.composerId ?? ''));
    const removed = before - data.allComposers.length;
    if (removed > 0) {
        writeJsonItem(db, COMPOSER_HEADERS_KEY, data);
    }

    return removed;
};

export const pruneCursorThreads = async (
    threads: CursorThreadSummary[],
    apply: boolean,
    userDir = resolveCursorUserDir(),
): Promise<CursorPruneResult> => {
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
    await pruneGlobalThreads(globalDbPath, threads, composerIds, result);
    await pruneWorkspaceBuckets(threads, composerIds, result, userDir);
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
    try {
        for (const thread of threads) {
            const deleted = pruneGlobalThread(db, thread.composerId);
            result.bubblesDeleted += deleted.bubbles;
            result.composerDataDeleted += deleted.composerData;
        }

        result.headersRemoved = removeThreadHeaders(db, composerIds);
    } finally {
        db.close();
    }
};

const pruneWorkspaceBuckets = async (
    _threads: CursorThreadSummary[],
    composerIds: Set<string>,
    result: CursorPruneResult,
    userDir: string,
): Promise<void> => {
    // Scan every bucket: a thread can live in more than one bucket's composer.composerData (e.g. the
    // current bucket plus the older bucket it was recovered from), so remove it from all of them.
    const groups = await listCursorWorkspaceGroups(userDir);
    const dbPaths = new Set<string>();
    for (const group of groups) {
        for (const bucket of group.buckets) {
            dbPaths.add(bucket.dbPath);
        }
    }

    for (const dbPath of dbPaths) {
        const db = new Database(dbPath);
        try {
            if (removeThreadFromBucket(db, composerIds)) {
                result.workspaceBucketsUpdated += 1;
            }
        } finally {
            db.close();
        }
    }
};

const pruneTranscriptDirs = async (threads: CursorThreadSummary[], result: CursorPruneResult): Promise<void> => {
    for (const thread of threads) {
        for (const dir of thread.transcriptDirs) {
            await rm(dir, { force: true, recursive: true });
            result.transcriptDirsRemoved += 1;
        }
    }
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
            summaries.push({
                bubbleBytes: 0,
                bubbleCount: countBubbles(db, composerId),
                bucketId: null,
                composerId,
                createdAtMs: null,
                lastUpdatedAtMs: null,
                mode: null,
                name: '',
                transcriptDirs: await findCursorTranscriptDirs(composerId),
                workspaceKey: '',
                workspaceLabel: '',
            });
        }
    } finally {
        db.close();
    }

    return summaries;
};
