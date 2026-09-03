import { constants, Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { decodeCursorChatModel, resolveCursorChatStorePath } from './cursor-chat-store';
import {
    COMPOSER_DATA_KEY,
    COMPOSER_HEADERS_KEY,
    type CursorBubble,
    type CursorBubbleKind,
    type CursorThreadHead,
    type CursorThreadSummary,
    type CursorThreadTranscript,
    type CursorToolCall,
    type CursorWorkspaceBucket,
    type CursorWorkspaceGroup,
    type CursorWorkspaceKind,
    getCursorGlobalDbPath,
    getCursorProjectsDir,
    getCursorWorkspaceStorageDir,
    resolveCursorUserDir,
} from './cursor-exporter-types';
import { getCursorBubbleKeyRange, isCursorBubbleKeyForComposer, isSafeCursorComposerId } from './cursor-id';
import { asNumber, asObject, asString, type JsonValue, pathExists, toFileUri } from './shared';
import { runWithSqliteRetry } from './sqlite-retry';

type ComposerEntry = Record<string, JsonValue> & {
    composerId?: string;
    name?: string;
    workspaceIdentifier?: { id?: string } | null;
};

type ComposerHeaderRow = {
    composerId: string;
    workspaceId: string | null;
    createdAt: number | null;
    lastUpdatedAt: number | null;
    isSubagent: number | null;
    value: string | null;
};

export const CURSOR_READONLY_DB_OPEN_FLAGS = constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI;
export const CURSOR_SQLITE_RETRY_DELAYS_MS = [40, 120, 250] as const;
export const CURSOR_MAX_HISTORY_ENTRIES_BYTES = 8 * 1024 * 1024;

// Cursor databases are WAL-mode. A plain read-only open fails once Cursor cleanly shuts down and
// removes the -wal/-shm sidecars, and the failure only surfaces at query time (so a try/catch around
// the constructor never sees it). immutable=1 reads the main database file directly, which works
// whether or not Cursor is running and whether or not the WAL sidecars are present. The explicit URI
// flag keeps this portable across SQLite builds where URI filename parsing is not enabled globally.
export const getCursorReadonlyDbUri = (dbPath: string, immutable = true): string => {
    const normalizedPath = dbPath.replace(/\\/gu, '/');
    const query = immutable ? 'immutable=1' : 'mode=ro';
    if (normalizedPath.startsWith('//')) {
        const [host, ...segments] = normalizedPath.slice(2).split('/');
        if (!host) {
            throw new Error(`Invalid Cursor UNC database path: ${dbPath}`);
        }
        return `file://${host}/${segments.map(encodeURIComponent).join('/')}?${query}`;
    }
    const absolutePath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
    const encodedPath = absolutePath
        .split('/')
        .map((segment) => (/^[A-Za-z]:$/u.test(segment) ? segment : encodeURIComponent(segment)))
        .join('/');

    return `file://${encodedPath}?${query}`;
};

export const openCursorReadonlyDb = (dbPath: string): Database => {
    const hasWalSidecars = existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`);
    return new Database(getCursorReadonlyDbUri(dbPath, !hasWalSidecars), CURSOR_READONLY_DB_OPEN_FLAGS);
};

const assertSynchronousCursorCallback = <T>(result: T): T => {
    if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        'then' in result &&
        typeof result.then === 'function'
    ) {
        throw new TypeError('Cursor SQLite callbacks must be synchronous');
    }

    return result;
};

export const withCursorReadonlyDb = <T>(dbPath: string, callback: (db: Database) => T): T =>
    runWithSqliteRetry({
        action: () => {
            const db = openCursorReadonlyDb(dbPath);
            try {
                return assertSynchronousCursorCallback(callback(db));
            } finally {
                db.close();
            }
        },
        delaysMs: CURSOR_SQLITE_RETRY_DELAYS_MS,
    });

export const withCursorWriteTransaction = <T>(dbPath: string, callback: (db: Database) => T): T =>
    runWithSqliteRetry({
        action: () => {
            const db = new Database(dbPath, { create: false, readwrite: true });
            let transactionStarted = false;
            try {
                db.exec('PRAGMA busy_timeout = 0');
                db.exec('BEGIN IMMEDIATE');
                transactionStarted = true;
                const result = assertSynchronousCursorCallback(callback(db));
                db.exec('COMMIT');
                transactionStarted = false;
                return result;
            } catch (error) {
                if (transactionStarted) {
                    try {
                        db.exec('ROLLBACK');
                    } catch {}
                }
                throw error;
            } finally {
                try {
                    db.close();
                } catch (closeError) {
                    console.warn('[spiracha:cursor] SQLite close failed', {
                        error: closeError instanceof Error ? closeError.message : String(closeError),
                    });
                }
            }
        },
        delaysMs: CURSOR_SQLITE_RETRY_DELAYS_MS,
    });

const isMissingOrUnreadableCursorStoreError = (error: unknown): boolean => {
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'SQLITE_CANTOPEN';
};

const readItemValue = <T>(db: Database, key: string): T | null => {
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

const readKvValue = <T>(db: Database, key: string): T | null => {
    const row = db.query('SELECT value FROM cursorDiskKV WHERE key = ?').get(key) as { value?: string } | null;
    if (!row?.value) {
        return null;
    }

    try {
        return JSON.parse(row.value) as T;
    } catch {
        return null;
    }
};

export const decodeCursorUri = (uri: string): string => {
    if (!uri) {
        return '';
    }

    if (uri.startsWith('file://')) {
        const rawPath = uri.slice('file://'.length);
        try {
            return decodeURIComponent(rawPath);
        } catch {
            return rawPath;
        }
    }

    return uri;
};

const normalizeCursorPath = (value: string): string => {
    const decoded = decodeCursorUri(value.trim());
    if (!decoded) {
        return '';
    }

    return decoded.replace(/\/+$/u, '') || decoded;
};

const warnCursorDataIssue = (event: string, details: Record<string, unknown>) => {
    console.warn(`[spiracha:cursor] ${event}`, details);
};

const stripJsonComments = (value: string): string => {
    return value.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1');
};

const parseCodeWorkspaceJson = (text: string): { folders?: Array<{ path?: string }> } => {
    try {
        return JSON.parse(text) as { folders?: Array<{ path?: string }> };
    } catch {
        return JSON.parse(stripJsonComments(text)) as { folders?: Array<{ path?: string }> };
    }
};

const isMissingCodeWorkspaceFileError = (error: unknown): boolean => {
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
};

const parseCodeWorkspaceFolders = async (workspaceFilePath: string): Promise<string[]> => {
    if (!workspaceFilePath.endsWith('.code-workspace')) {
        return [];
    }

    try {
        const data = parseCodeWorkspaceJson(await Bun.file(workspaceFilePath).text());
        const folders: string[] = [];
        for (const entry of data.folders ?? []) {
            const folderPath = entry.path;
            if (!folderPath) {
                continue;
            }

            folders.push(
                folderPath.startsWith('/')
                    ? normalizeCursorPath(folderPath)
                    : normalizeCursorPath(path.join(path.dirname(workspaceFilePath), folderPath)),
            );
        }

        return folders;
    } catch (error) {
        if (isMissingCodeWorkspaceFileError(error)) {
            return [];
        }

        warnCursorDataIssue('invalid_code_workspace_json', {
            error: error instanceof Error ? error.message : String(error),
            workspaceFilePath,
        });
        return [];
    }
};

const parseComposerHeaderRow = (row: ComposerHeaderRow): ComposerEntry => {
    let parsed: ComposerEntry = {};
    try {
        parsed = (asObject(JSON.parse(row.value ?? '{}') as JsonValue) ?? {}) as ComposerEntry;
    } catch {
        parsed = {};
    }

    return {
        ...parsed,
        composerId: row.composerId,
        createdAt: asNumber(parsed.createdAt ?? null) ?? row.createdAt,
        isSubagent: row.isSubagent === 1,
        lastUpdatedAt: asNumber(parsed.lastUpdatedAt ?? null) ?? row.lastUpdatedAt,
        workspaceIdentifier: parsed.workspaceIdentifier ?? (row.workspaceId ? { id: row.workspaceId } : null),
    };
};

const readModernComposerHeaders = (db: Database): ComposerEntry[] => {
    const modernTable = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'composerHeaders'").get();
    if (!modernTable) {
        return [];
    }

    const rows = db
        .query('SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isSubagent, value FROM composerHeaders')
        .all() as ComposerHeaderRow[];
    return rows.map(parseComposerHeaderRow);
};

export const loadGlobalComposerHeadersStrict = (globalDbPath: string): ComposerEntry[] =>
    withCursorReadonlyDb(globalDbPath, (db) => {
        const legacy = readItemValue<{ allComposers?: ComposerEntry[] }>(db, COMPOSER_HEADERS_KEY);
        const headersById = new Map<string, ComposerEntry>();
        for (const header of [...(legacy?.allComposers ?? []), ...readModernComposerHeaders(db)]) {
            if (header.composerId) {
                headersById.set(header.composerId, header);
            }
        }
        return [...headersById.values()];
    });

export const loadGlobalComposerHeaders = (globalDbPath: string): ComposerEntry[] => {
    try {
        return loadGlobalComposerHeadersStrict(globalDbPath);
    } catch (error) {
        warnCursorDataIssue('global_composer_headers_unavailable', {
            error: error instanceof Error ? error.message : String(error),
            globalDbPath,
        });
        return [];
    }
};

const readBucketWorkspaceJson = async (
    workspaceJsonPath: string,
): Promise<{ folder?: string; workspace?: string } | null> => {
    try {
        return (await Bun.file(workspaceJsonPath).json()) as { folder?: string; workspace?: string };
    } catch {
        return null;
    }
};

const resolveBucketIdentity = async (
    wsData: { folder?: string; workspace?: string },
    bucketId: string,
): Promise<{ kind: CursorWorkspaceKind; uri: string; label: string; folders: string[] }> => {
    if (wsData.folder) {
        const folder = normalizeCursorPath(wsData.folder);
        return {
            folders: folder ? [folder] : [],
            kind: 'folder',
            label: folder ? path.basename(folder) : bucketId,
            uri: wsData.folder,
        };
    }

    if (wsData.workspace) {
        const workspacePath = normalizeCursorPath(wsData.workspace);
        return {
            folders: workspacePath ? await parseCodeWorkspaceFolders(workspacePath) : [],
            kind: 'workspace',
            label: workspacePath ? path.basename(workspacePath) : bucketId,
            uri: wsData.workspace,
        };
    }

    return { folders: [], kind: 'unknown', label: bucketId, uri: '' };
};

const readBucketComposerIdsStrict = (dbPath: string): string[] =>
    withCursorReadonlyDb(dbPath, (db) => {
        const data = readItemValue<{ allComposers?: ComposerEntry[] }>(db, COMPOSER_DATA_KEY);
        return (data?.allComposers ?? [])
            .map((entry) => entry.composerId)
            .filter((value): value is string => Boolean(value));
    });

const readBucketComposerIds = (dbPath: string): string[] => {
    try {
        return readBucketComposerIdsStrict(dbPath);
    } catch {
        return [];
    }
};

type CursorBucketComposerIdReader = (dbPath: string) => string[];

const loadCursorBucketsInternal = async (
    userDir: string,
    readHeaders: (globalDbPath: string) => ComposerEntry[],
    readComposerIds: CursorBucketComposerIdReader,
): Promise<CursorWorkspaceBucket[]> => {
    const workspaceStorageDir = getCursorWorkspaceStorageDir(userDir);
    let bucketIds: string[] = [];
    try {
        bucketIds = await readdir(workspaceStorageDir);
    } catch {
        return [];
    }

    const globalDbPath = getCursorGlobalDbPath(userDir);
    const headerIdsByBucket = new Map<string, Set<string>>();
    if (await pathExists(globalDbPath)) {
        for (const header of readHeaders(globalDbPath)) {
            const id = header.workspaceIdentifier?.id;
            if (id && header.composerId) {
                const set = headerIdsByBucket.get(id) ?? new Set<string>();
                set.add(header.composerId);
                headerIdsByBucket.set(id, set);
            }
        }
    }

    const buckets: CursorWorkspaceBucket[] = [];
    for (const bucketId of bucketIds) {
        const bucket = await buildBucket(workspaceStorageDir, bucketId, headerIdsByBucket, readComposerIds);
        if (bucket) {
            buckets.push(bucket);
        }
    }

    return buckets;
};

export const loadCursorBuckets = async (userDir = resolveCursorUserDir()): Promise<CursorWorkspaceBucket[]> =>
    loadCursorBucketsInternal(userDir, loadGlobalComposerHeaders, readBucketComposerIds);

const loadCursorBucketsStrict = async (userDir: string): Promise<CursorWorkspaceBucket[]> =>
    loadCursorBucketsInternal(userDir, loadGlobalComposerHeadersStrict, readBucketComposerIdsStrict);

const buildBucket = async (
    workspaceStorageDir: string,
    bucketId: string,
    headerIdsByBucket: Map<string, Set<string>>,
    readComposerIds: CursorBucketComposerIdReader,
): Promise<CursorWorkspaceBucket | null> => {
    const root = path.join(workspaceStorageDir, bucketId);
    const workspaceJsonPath = path.join(root, 'workspace.json');
    const dbPath = path.join(root, 'state.vscdb');
    if (!(await pathExists(workspaceJsonPath)) || !(await pathExists(dbPath))) {
        return null;
    }

    const wsData = await readBucketWorkspaceJson(workspaceJsonPath);
    if (!wsData || (!wsData.folder && !wsData.workspace)) {
        return null;
    }

    let identity: Awaited<ReturnType<typeof resolveBucketIdentity>>;
    let dbStat: Awaited<ReturnType<typeof stat>>;
    let composerIds: string[];
    try {
        identity = await resolveBucketIdentity(wsData, bucketId);
        dbStat = await stat(dbPath);
        composerIds = readComposerIds(dbPath);
    } catch (error) {
        if (isMissingOrUnreadableCursorStoreError(error)) {
            return null;
        }

        throw error;
    }

    const headerIds = headerIdsByBucket.get(bucketId) ?? new Set<string>();
    const threadComposerIds = [...new Set([...composerIds, ...headerIds])];

    return {
        bucketId,
        composerCount: composerIds.length,
        dbPath,
        dbSizeBytes: dbStat.size,
        folders: identity.folders,
        globalHeaderCount: headerIds.size,
        kind: identity.kind,
        label: identity.label,
        mtimeMs: dbStat.mtimeMs,
        threadComposerIds,
        uri: identity.uri,
        workspaceJsonPath,
    };
};

export const getCursorWorkspaceGroupKey = (bucket: CursorWorkspaceBucket): string => {
    if (bucket.kind === 'folder' && bucket.folders[0]) {
        return `folder:${bucket.folders[0]}`;
    }

    if (bucket.kind === 'workspace') {
        return `workspace:${normalizeCursorPath(bucket.uri)}`;
    }

    return `unknown:${bucket.bucketId}`;
};

export const groupCursorBuckets = (buckets: CursorWorkspaceBucket[]): CursorWorkspaceGroup[] => {
    const grouped = new Map<string, CursorWorkspaceBucket[]>();
    for (const bucket of buckets) {
        const key = getCursorWorkspaceGroupKey(bucket);
        const list = grouped.get(key) ?? [];
        list.push(bucket);
        grouped.set(key, list);
    }

    const groups: CursorWorkspaceGroup[] = [];
    for (const [key, list] of grouped.entries()) {
        const ranked = [...list].sort((a, b) => b.mtimeMs - a.mtimeMs || b.dbSizeBytes - a.dbSizeBytes);
        const primary = ranked[0]!;
        const newest = ranked[0]!;
        // De-duplicate composer ids across buckets so the same thread isn't counted once per bucket.
        const threadCount = new Set(ranked.flatMap((bucket) => bucket.threadComposerIds)).size;
        const olderWithData = ranked
            .slice(1)
            .some((bucket) => bucket.composerCount > 0 || bucket.globalHeaderCount > 0);

        groups.push({
            buckets: ranked,
            folders: primary.folders,
            key,
            kind: primary.kind,
            label: primary.label,
            lastActiveMs: Math.max(...ranked.map((bucket) => bucket.mtimeMs)),
            needsRecovery: ranked.length > 1 && olderWithData && newest.composerCount === 0,
            threadCount,
            uri: primary.uri,
        });
    }

    return groups.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
};

export const listCursorWorkspaceGroups = async (
    userDir = resolveCursorUserDir(),
    options: CursorDiscoveryOptions = {},
): Promise<CursorWorkspaceGroup[]> => {
    return (await discoverCursorWorkspaces(userDir, options)).groups;
};

export const cursorBucketMatchesQuery = (bucket: CursorWorkspaceBucket, query: string): boolean => {
    const raw = query.trim();
    if (!raw) {
        return true;
    }

    const lowered = raw.toLowerCase();
    const looksLikePath = raw.startsWith('/') || raw.startsWith('~') || raw.includes('/');

    if (looksLikePath) {
        const normalized = normalizeCursorPath(raw);
        if (bucket.folders.includes(normalized)) {
            return true;
        }

        const bucketUri = decodeCursorUri(bucket.uri);
        return bucketUri === normalized || bucketUri.endsWith(raw) || bucketUri.endsWith(normalized);
    }

    if (raw.endsWith('.code-workspace')) {
        return (
            decodeCursorUri(bucket.uri).toLowerCase().endsWith(lowered) ||
            path.basename(decodeCursorUri(bucket.uri)).toLowerCase() === lowered
        );
    }

    if (lowered === bucket.bucketId.toLowerCase() || lowered === bucket.label.toLowerCase()) {
        return true;
    }

    return bucket.folders.some((folder) => path.basename(folder).toLowerCase() === lowered);
};

const groupMatchesQuery = (group: CursorWorkspaceGroup, query: string): boolean => {
    if (group.buckets.some((bucket) => cursorBucketMatchesQuery(bucket, query))) {
        return true;
    }

    // Bucket-less groups (workspaces whose storage was pruned, or inferred from thread tool paths)
    // still need to match by folder path, basename, or group key.
    const raw = query.trim();
    if (!raw) {
        return true;
    }

    const lowered = raw.toLowerCase();
    if (group.key.toLowerCase() === lowered || group.label.toLowerCase() === lowered) {
        return true;
    }

    if (raw.startsWith('/') || raw.includes('/')) {
        const normalized = normalizeCursorPath(raw);
        return group.folders.some((folder) => folder === normalized || folder.endsWith(normalized));
    }

    return group.folders.some((folder) => path.basename(folder).toLowerCase() === lowered);
};

export const findCursorWorkspaceGroups = (groups: CursorWorkspaceGroup[], query: string): CursorWorkspaceGroup[] => {
    return groups.filter((group) => groupMatchesQuery(group, query));
};

const countBubbles = (db: Database, composerId: string): { count: number; bytes: number } => {
    const range = getCursorBubbleKeyRange(composerId);
    const rows = db
        .query('SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ?')
        .all(range.start, range.end) as Array<{ key: string; value: string }>;
    const exactRows = rows.filter((row) => isCursorBubbleKeyForComposer(row.key, row.value, composerId));
    return {
        bytes: exactRows.reduce((sum, row) => sum + row.value.length, 0),
        count: exactRows.length,
    };
};

export const findCursorTranscriptDirsForComposerIds = async (
    composerIds: Iterable<string>,
    userDir = resolveCursorUserDir(),
): Promise<Map<string, string[]>> => {
    const safeComposerIds = new Set([...composerIds].filter(isSafeCursorComposerId));
    const matches = new Map([...safeComposerIds].map((composerId) => [composerId, [] as string[]]));
    if (safeComposerIds.size === 0) {
        return matches;
    }

    const projectsDir = getCursorProjectsDir(userDir);
    if (!(await pathExists(projectsDir))) {
        return matches;
    }

    let projectDirs: string[] = [];
    try {
        projectDirs = await readdir(projectsDir);
    } catch {
        return matches;
    }

    await Promise.all(
        projectDirs.map(async (projectDir) => {
            const agentTranscriptsDir = path.resolve(projectsDir, projectDir, 'agent-transcripts');
            let entries: string[];
            try {
                entries = await readdir(agentTranscriptsDir);
            } catch {
                return;
            }

            for (const composerId of entries) {
                if (!safeComposerIds.has(composerId)) {
                    continue;
                }

                const transcriptDir = path.resolve(agentTranscriptsDir, composerId);
                const relativePath = path.relative(agentTranscriptsDir, transcriptDir);
                if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
                    continue;
                }

                matches.get(composerId)!.push(transcriptDir);
            }
        }),
    );

    return matches;
};

export const findCursorTranscriptDirs = async (
    composerId: string,
    userDir = resolveCursorUserDir(),
): Promise<string[]> => {
    return (await findCursorTranscriptDirsForComposerIds([composerId], userDir)).get(composerId) ?? [];
};

export type ListCursorThreadsOptions = {
    includeBubbleStats?: boolean;
    includeModelAttribution?: boolean;
    includeTranscriptDirs?: boolean;
    updatedAfterMs?: number;
};

const readCursorChatStoreModel = async (
    composerId: string,
    transcriptDirs: string[],
): Promise<{ model: string; reasoningEffort: string | null } | null> => {
    for (const transcriptDir of transcriptDirs) {
        const projectDir = path.dirname(path.dirname(transcriptDir));
        const storePath = await resolveCursorChatStorePath(projectDir, composerId);
        if (!storePath) {
            continue;
        }

        try {
            const model = withCursorReadonlyDb(storePath, (db) => {
                const rows = db
                    .query("SELECT data FROM blobs WHERE instr(CAST(data AS TEXT), 'cursor-grok-') > 0")
                    .all() as Array<{ data: string | Uint8Array }>;
                return decodeCursorChatModel(rows.map((row) => row.data));
            });
            if (model) {
                return model;
            }
        } catch {
            // Modern chat stores are optional and may be concurrently replaced by Cursor.
        }
    }

    return null;
};

const hydrateCursorChatStoreModels = async (
    threads: CursorThreadSummary[],
    transcriptDirsByComposerId: Map<string, string[]>,
): Promise<CursorThreadSummary[]> =>
    Promise.all(
        threads.map(async (thread) => {
            if (thread.model) {
                return thread;
            }

            const model = await readCursorChatStoreModel(
                thread.composerId,
                transcriptDirsByComposerId.get(thread.composerId) ?? [],
            );
            return model ? { ...thread, ...model } : thread;
        }),
    );

const hydrateCursorThreadSummaries = async (
    threads: CursorThreadSummary[],
    userDir: string,
    options: ListCursorThreadsOptions,
): Promise<CursorThreadSummary[]> => {
    const threadsWithStats =
        options.includeBubbleStats === false ? threads : await hydrateCursorThreadBubbleStats(threads, userDir);
    const shouldHydrateModels = options.includeModelAttribution !== false;
    const shouldResolveTranscriptDirs = options.includeTranscriptDirs !== false || shouldHydrateModels;
    const transcriptDirsByComposerId = shouldResolveTranscriptDirs
        ? await findCursorTranscriptDirsForComposerIds(
              threadsWithStats.map((thread) => thread.composerId),
              userDir,
          )
        : new Map<string, string[]>();
    const hydratedThreads = shouldHydrateModels
        ? await hydrateCursorChatStoreModels(threadsWithStats, transcriptDirsByComposerId)
        : threadsWithStats;
    if (options.includeTranscriptDirs === false) {
        return hydratedThreads;
    }

    return hydratedThreads.map((thread) => ({
        ...thread,
        transcriptDirs: transcriptDirsByComposerId.get(thread.composerId) ?? [],
    }));
};

export const listCursorThreadsForGroup = async (
    group: CursorWorkspaceGroup,
    userDir = resolveCursorUserDir(),
    options: ListCursorThreadsOptions = {},
): Promise<CursorThreadSummary[]> => {
    const discovery = await discoverCursorWorkspaces(userDir, options);
    const discoveredThreads = discovery.threadsByKey.get(group.key) ?? [];
    return hydrateCursorThreadSummaries(discoveredThreads, userDir, options);
};

export const getCursorThreadSummaryByComposerId = async (
    composerId: string,
    userDir = resolveCursorUserDir(),
    options: ListCursorThreadsOptions = {},
): Promise<{ group: CursorWorkspaceGroup; thread: CursorThreadSummary } | null> => {
    if (!isSafeCursorComposerId(composerId)) {
        return null;
    }

    const discovered = (await discoverCursorWorkspaces(userDir, options)).threadsByComposerId.get(composerId);
    if (!discovered) {
        return null;
    }

    const [thread] = await hydrateCursorThreadSummaries([discovered.thread], userDir, options);
    return thread ? { group: discovered.group, thread } : null;
};

// Older threads' workspace buckets get pruned by Cursor over time, and many threads predate the
// workspace-linking migration, so a bucket-only walk hides large amounts of history. Discovery
// instead enumerates every thread in the global store and resolves each to a folder via (in order):
// its global header workspace uri, an existing bucket it points at, or — for threads with no such
// link — the dominant absolute path found in its tool calls.

type ParsedGlobalHead = {
    name: string | null;
    createdAtMs: number | null;
    lastUpdatedAtMs: number | null;
    mode: string | null;
    pathHint: string | null;
    model: string | null;
    reasoningEffort: string | null;
    status: string | null;
};
type GlobalHead = ParsedGlobalHead & { hasBubbleData: boolean };
type HeaderInfo = {
    name: string | null;
    uriPath: string | null;
    bucketId: string | null;
    parentComposerId: string | null;
};
type BubbleStat = { count: number; bytes: number };

type CursorDiscovery = {
    groups: CursorWorkspaceGroup[];
    threadsByComposerId: Map<string, { group: CursorWorkspaceGroup; thread: CursorThreadSummary }>;
    threadsByKey: Map<string, CursorThreadSummary[]>;
};

type CursorDiscoveryOptions = {
    strict?: boolean;
    updatedAfterMs?: number;
};

// Discovery does a full scan of the (potentially multi-GB) global DB, so cache it briefly. Writes
// (recover/prune/delete) call invalidateCursorDiscoveryCache() so the UI never shows stale results.
const DISCOVERY_TTL_MS = 60_000;
const DISCOVERY_CACHE_MAX_ENTRIES = 8;
const UNKNOWN_GROUP_KEY = 'unknown';
const discoveryCache = new Map<string, { at: number; value: CursorDiscovery }>();
const discoveryInFlight = new Map<string, Promise<CursorDiscovery>>();
let discoveryGeneration = 0;

export const invalidateCursorDiscoveryCache = (): void => {
    discoveryGeneration += 1;
    discoveryCache.clear();
    discoveryInFlight.clear();
};

const DEV_CONTAINER_DIRS = [
    'workspace',
    'projects',
    'dev',
    'code',
    'repos',
    'src',
    'Documents',
    'Downloads',
    'Desktop',
];
const HOME_ROOT_PATTERN = '(?:/Users/[^/]+|/home/[^/]+|/mnt/[A-Za-z]/Users/[^/]+|/?[A-Za-z]:/Users/[^/]+)';
const REVERSE_WORKSPACE_ROOT_RE = new RegExp(`^${HOME_ROOT_PATTERN}/workspace/reverse/[^/]+`, 'u');
const CONTAINER_ROOT_RE = new RegExp(`^(${HOME_ROOT_PATTERN}/(?:${DEV_CONTAINER_DIRS.join('|')})/[^/]+)`);
const HOME_PROJECT_ROOT_RE = new RegExp(`^(${HOME_ROOT_PATTERN}/[^/]+)`);
const ABS_PATH_RE = /(?:\/(?:Users|home)\/|\/mnt\/[A-Za-z]\/Users\/|\/?[A-Za-z]:[\\/]+Users[\\/]+)[^"'\s:,)\]]+/g;

const isNoisePath = (value: string): boolean =>
    /\/Library(?:\/|$)|\/\.cursor(?:\/|$)|\/node_modules\/|\/\.git\/|^\/tmp|^\/var|^\/private|\/\.Trash\//u.test(
        value,
    ) || /^\/Users\/[^/]+\/(?:Downloads|Desktop)$/u.test(value);

const stripLikelyFileName = (value: string): string => {
    const basename = path.basename(value);
    return basename.includes('.') ? path.dirname(value) : value;
};

const containerRootFromPath = (value: string): string | null => {
    const candidate = stripLikelyFileName(normalizeCursorPath(value).replace(/\\+/g, '/'));
    const reverseMatch = candidate.match(REVERSE_WORKSPACE_ROOT_RE);
    if (reverseMatch) {
        return reverseMatch[0] ?? null;
    }

    const match = candidate.match(CONTAINER_ROOT_RE);
    if (match) {
        return match[1] ?? null;
    }

    return candidate.match(HOME_PROJECT_ROOT_RE)?.[1] ?? null;
};

const inferFolderFromPaths = (paths: string[]): string | null => {
    const counts = new Map<string, number>();
    for (const value of paths) {
        const normalized = value.replace(/\\+/g, '/');
        if (isNoisePath(normalized)) {
            continue;
        }

        const root = containerRootFromPath(normalized);
        if (root) {
            counts.set(root, (counts.get(root) ?? 0) + 1);
        }
    }

    let best: string | null = null;
    let bestCount = 0;
    for (const [root, count] of counts) {
        if (count > bestCount) {
            best = root;
            bestCount = count;
        }
    }

    return best;
};

const inferFolderFromBlob = (blob: string): string | null => {
    const matches = blob.match(ABS_PATH_RE);
    return matches ? inferFolderFromPaths(matches) : null;
};

const readCursorHistoryActivityEntry = async (
    entriesPath: string,
): Promise<{ folder: string; lastActiveMs: number } | null> => {
    let entriesStat: Awaited<ReturnType<typeof stat>>;
    try {
        entriesStat = await stat(entriesPath);
    } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT' && (error as { code?: unknown }).code !== 'ENOTDIR') {
            warnCursorDataIssue('history_entries_stat_failed', {
                entriesPath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return null;
    }
    if (entriesStat.size > CURSOR_MAX_HISTORY_ENTRIES_BYTES) {
        warnCursorDataIssue('history_entries_oversized', {
            entriesPath,
            maxBytes: CURSOR_MAX_HISTORY_ENTRIES_BYTES,
            sizeBytes: entriesStat.size,
        });
        return null;
    }

    let data: { resource?: unknown; entries?: unknown };
    try {
        data = (await Bun.file(entriesPath).json()) as { resource?: unknown; entries?: unknown };
    } catch (error) {
        warnCursorDataIssue('invalid_history_entries_json', {
            entriesPath,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }

    const resource = typeof data.resource === 'string' ? data.resource : '';
    const folder = containerRootFromPath(resource);
    if (!folder || isNoisePath(folder)) {
        return null;
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    const timestamps = entries.map((item) => {
        if (!item || typeof item !== 'object') {
            return 0;
        }
        const timestamp = (item as { timestamp?: unknown }).timestamp;
        return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : 0;
    });
    return { folder, lastActiveMs: Math.max(0, ...timestamps) };
};

const readCursorFileHistoryProjectActivity = async (userDir: string): Promise<Map<string, number>> => {
    const historyDir = path.join(userDir, 'History');
    let entries: Array<{ isDirectory: () => boolean; name: string }> = [];
    try {
        entries = await readdir(historyDir, { withFileTypes: true });
    } catch {
        return new Map();
    }

    const activity = new Map<string, number>();
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const record = await readCursorHistoryActivityEntry(path.join(historyDir, entry.name, 'entries.json'));
        if (record) {
            activity.set(record.folder, Math.max(activity.get(record.folder) ?? 0, record.lastActiveMs));
        }
    }

    return activity;
};

const extractCursorBubblePaths = (value: string): string[] => {
    let bubble: Record<string, JsonValue>;
    try {
        bubble = JSON.parse(value) as Record<string, JsonValue>;
    } catch {
        return [];
    }

    const tool = asObject(bubble.toolFormerData ?? null);
    if (!tool) {
        return [];
    }

    const blob = `${asString(tool.rawArgs ?? null) ?? ''} ${asString(tool.params ?? null) ?? ''}`;
    return blob.match(ABS_PATH_RE) ?? [];
};

const inferFolderFromBubbles = (db: Database, composerId: string): string | null => {
    const range = getCursorBubbleKeyRange(composerId);
    const rows = db
        .query('SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ? LIMIT 80')
        .all(range.start, range.end) as Array<{ key: string; value: string }>;
    const paths: string[] = [];

    for (const { key, value } of rows) {
        if (!isCursorBubbleKeyForComposer(key, value, composerId)) {
            continue;
        }
        paths.push(...extractCursorBubblePaths(value));

        if (paths.length > 200) {
            break;
        }
    }

    return inferFolderFromPaths(paths);
};

const readAllHeads = (db: Database, options: CursorDiscoveryOptions = {}): Map<string, GlobalHead> => {
    if (options.updatedAfterMs !== undefined) {
        const rows = db
            .query(
                `SELECT substr(key, 14) AS id, value
                 FROM cursorDiskKV
                 WHERE key LIKE 'composerData:%'
                    AND COALESCE(json_extract(value, '$.lastUpdatedAt'), 0) >= ?`,
            )
            .all(options.updatedAfterMs) as Array<{ id: string; value: string | null }>;

        return new Map(
            rows.map((row) => [
                row.id,
                { ...parseGlobalHead(row.value), hasBubbleData: hasStoredCursorBubbleData(row.value) },
            ]),
        );
    }

    const rows = db
        .query(`SELECT substr(key, 14) AS id, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
        .all() as Array<{ id: string; value: string | null }>;

    return new Map(
        rows.map((row) => [
            row.id,
            { ...parseGlobalHead(row.value), hasBubbleData: hasStoredCursorBubbleData(row.value) },
        ]),
    );
};

const hasStoredCursorBubbleData = (value: string | null): boolean => {
    if (value === null) {
        return false;
    }

    try {
        const parsed = asObject(JSON.parse(value) as JsonValue);
        if (!parsed) {
            return false;
        }

        const totalBubbleHeaderCount = asNumber(parsed.totalBubbleHeaderCount ?? null);
        if (totalBubbleHeaderCount !== null) {
            return totalBubbleHeaderCount > 0;
        }

        return Array.isArray(parsed.fullConversationHeadersOnly) && parsed.fullConversationHeadersOnly.length > 0;
    } catch {
        return true;
    }
};

const parseGlobalHead = (value: string | null): ParsedGlobalHead => {
    let parsed: Record<string, JsonValue> | null = {};
    if (value === null) {
        return {
            createdAtMs: null,
            lastUpdatedAtMs: null,
            mode: null,
            model: null,
            name: null,
            pathHint: null,
            reasoningEffort: null,
            status: null,
        };
    }

    try {
        parsed = asObject(JSON.parse(value) as JsonValue);
    } catch {
        return {
            createdAtMs: null,
            lastUpdatedAtMs: null,
            mode: null,
            model: null,
            name: null,
            pathHint: inferFolderFromBlob(value),
            reasoningEffort: null,
            status: null,
        };
    }

    if (!parsed) {
        return {
            createdAtMs: null,
            lastUpdatedAtMs: null,
            mode: null,
            model: null,
            name: null,
            pathHint: inferFolderFromBlob(value),
            reasoningEffort: null,
            status: null,
        };
    }

    const modelConfig = asObject(parsed.modelConfig ?? null);
    const selectedModels = Array.isArray(modelConfig?.selectedModels) ? modelConfig.selectedModels : [];
    const selectedModel = selectedModels
        .map((entry) => asObject(entry))
        .find((entry) => asString(entry?.modelId ?? null) === asString(modelConfig?.modelName ?? null));
    const parameters = Array.isArray(selectedModel?.parameters) ? selectedModel.parameters : [];
    const reasoningEffort = parameters
        .map((parameter) => asObject(parameter))
        .find((parameter) => asString(parameter?.id ?? null) === 'effort');
    const rawModel = asString(modelConfig?.modelName ?? null);
    const encodedGrokModel = rawModel?.match(/^cursor-(grok-[\d.]+)-(low|medium|high)$/u);

    return {
        createdAtMs: asNumber(parsed.createdAt ?? null),
        lastUpdatedAtMs: asNumber(parsed.lastUpdatedAt ?? null),
        mode: asString(parsed.unifiedMode ?? null),
        model: encodedGrokModel?.[1] ?? rawModel,
        name: asString(parsed.name ?? null),
        pathHint: inferFolderFromBlob(value),
        reasoningEffort: asString(reasoningEffort?.value ?? null) ?? encodedGrokModel?.[2] ?? null,
        status: asString(parsed.status ?? null),
    };
};

const readBubbleStats = (db: Database, composerIds: Iterable<string>): Map<string, BubbleStat> => {
    const ids = [...new Set(composerIds)];
    if (ids.length === 0) {
        return new Map();
    }

    const stats = new Map<string, BubbleStat>();
    for (let index = 0; index < ids.length; index += 200) {
        const chunk = ids.slice(index, index + 200);
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
            if (!isCursorBubbleKeyForComposer(row.key, row.value, row.composerId)) {
                continue;
            }

            const composerId = row.composerId;
            const current = stats.get(composerId) ?? { bytes: 0, count: 0 };
            stats.set(composerId, {
                bytes: current.bytes + row.value.length,
                count: current.count + 1,
            });
        }
    }

    return stats;
};

const hydrateCursorThreadBubbleStats = async (
    threads: CursorThreadSummary[],
    userDir: string,
): Promise<CursorThreadSummary[]> => {
    if (threads.length === 0) {
        return threads;
    }

    const globalDbPath = getCursorGlobalDbPath(userDir);
    if (!(await pathExists(globalDbPath))) {
        return threads;
    }

    const stats = withCursorReadonlyDb(globalDbPath, (db) =>
        readBubbleStats(
            db,
            threads.map((thread) => thread.composerId),
        ),
    );
    return threads.map((thread) => {
        const stat = stats.get(thread.composerId);
        return stat
            ? {
                  ...thread,
                  bubbleBytes: stat.bytes,
                  bubbleCount: stat.count,
              }
            : thread;
    });
};

const readHeaderInfo = (globalDbPath: string, strict = false): Map<string, HeaderInfo> => {
    const info = new Map<string, HeaderInfo>();
    for (const header of (strict ? loadGlobalComposerHeadersStrict : loadGlobalComposerHeaders)(globalDbPath)) {
        if (!header.composerId) {
            continue;
        }

        const identifier = header.workspaceIdentifier as
            | { id?: string; uri?: { path?: string; fsPath?: string } }
            | undefined;
        const uriPath = identifier?.uri?.path ?? identifier?.uri?.fsPath ?? null;
        const subagentInfo = asObject(header.subagentInfo ?? null);
        info.set(header.composerId, {
            bucketId: identifier?.id ?? null,
            name: typeof header.name === 'string' ? header.name : null,
            parentComposerId: asString(subagentInfo?.parentComposerId ?? null),
            uriPath: uriPath ? normalizeCursorPath(uriPath) : null,
        });
    }

    return info;
};

const collectBucketComposerIds = (buckets: CursorWorkspaceBucket[], strict = false): Map<string, string> => {
    const map = new Map<string, string>();
    for (const bucket of buckets) {
        for (const composerId of (strict ? readBucketComposerIdsStrict : readBucketComposerIds)(bucket.dbPath)) {
            if (!map.has(composerId)) {
                map.set(composerId, bucket.bucketId);
            }
        }
    }

    return map;
};

type ResolvedThread = {
    composerId: string;
    name: string;
    createdAtMs: number | null;
    lastUpdatedAtMs: number | null;
    mode: string | null;
    stat: BubbleStat;
    folder: string | null;
    groupKey: string;
    groupLabel: string;
    bucketId: string | null;
    model: string | null;
    reasoningEffort: string | null;
    parentComposerId: string | null;
    hasBubbleData?: boolean;
    status: string | null;
};

const findLinkedBucketId = (
    composerId: string,
    headerInfo: HeaderInfo | undefined,
    bucketIdToGroupKey: Map<string, string>,
    bucketComposerIds: Map<string, string>,
): string | null => {
    if (headerInfo?.bucketId && bucketIdToGroupKey.has(headerInfo.bucketId)) {
        return headerInfo.bucketId;
    }

    return bucketComposerIds.get(composerId) ?? null;
};

const resolveThreadFolderHint = (
    composerId: string,
    head: GlobalHead | undefined,
    headerInfo: HeaderInfo | undefined,
    stat: BubbleStat,
    linkedBucketId: string | null,
    bucketIdToGroupKey: Map<string, string>,
    bucketIdToFolder: Map<string, string | null>,
    db: Database,
): { folder: string | null; groupKey: string } => {
    if (linkedBucketId && bucketIdToGroupKey.has(linkedBucketId)) {
        return {
            folder: bucketIdToFolder.get(linkedBucketId) ?? null,
            groupKey: bucketIdToGroupKey.get(linkedBucketId)!,
        };
    }

    if (headerInfo?.uriPath) {
        return { folder: headerInfo.uriPath, groupKey: `folder:${headerInfo.uriPath}` };
    }

    if (head?.pathHint) {
        return { folder: head.pathHint, groupKey: `folder:${head.pathHint}` };
    }

    if (stat.count > 0 || head?.hasBubbleData) {
        const folder = inferFolderFromBubbles(db, composerId);
        return { folder, groupKey: folder ? `folder:${folder}` : UNKNOWN_GROUP_KEY };
    }

    return { folder: null, groupKey: UNKNOWN_GROUP_KEY };
};

const resolveThreadFolder = (
    composerId: string,
    head: GlobalHead | undefined,
    headerInfo: HeaderInfo | undefined,
    stat: BubbleStat,
    bucketIdToGroupKey: Map<string, string>,
    bucketIdToFolder: Map<string, string | null>,
    bucketComposerIds: Map<string, string>,
    db: Database,
): ResolvedThread => {
    const linkedBucketId = findLinkedBucketId(composerId, headerInfo, bucketIdToGroupKey, bucketComposerIds);
    const { folder, groupKey } = resolveThreadFolderHint(
        composerId,
        head,
        headerInfo,
        stat,
        linkedBucketId,
        bucketIdToGroupKey,
        bucketIdToFolder,
        db,
    );

    return {
        bucketId: linkedBucketId,
        composerId,
        createdAtMs: head?.createdAtMs ?? null,
        folder,
        groupKey,
        groupLabel: folder ? path.basename(folder) : 'Unknown project',
        hasBubbleData: Boolean(head?.hasBubbleData || stat.count > 0),
        lastUpdatedAtMs: head?.lastUpdatedAtMs ?? null,
        mode: head?.mode ?? null,
        model: head?.model ?? null,
        name: head?.name || headerInfo?.name || '(untitled)',
        parentComposerId: headerInfo?.parentComposerId ?? null,
        reasoningEffort: head?.reasoningEffort ?? null,
        stat,
        status: head?.status ?? null,
    };
};

const toThreadSummary = (resolved: ResolvedThread): CursorThreadSummary => ({
    bubbleBytes: resolved.stat.bytes,
    bubbleCount: resolved.stat.count,
    bucketId: resolved.bucketId,
    composerId: resolved.composerId,
    createdAtMs: resolved.createdAtMs,
    lastUpdatedAtMs: resolved.lastUpdatedAtMs,
    mode: resolved.mode,
    model: resolved.model,
    name: resolved.name,
    parentComposerId: resolved.parentComposerId,
    reasoningEffort: resolved.reasoningEffort,
    transcriptDirs: [],
    workspaceKey: resolved.groupKey,
    workspaceLabel: resolved.groupLabel,
});

const shouldIncludeResolvedThread = (thread: ResolvedThread): boolean => {
    const hasBubbleData = thread.hasBubbleData ?? thread.stat.count > 0;
    return !(
        (!hasBubbleData && thread.status === 'aborted') ||
        (thread.groupKey === UNKNOWN_GROUP_KEY && !hasBubbleData)
    );
};

const indexThreadsByComposerId = (
    groups: CursorWorkspaceGroup[],
    threadsByKey: Map<string, CursorThreadSummary[]>,
): Map<string, { group: CursorWorkspaceGroup; thread: CursorThreadSummary }> => {
    const groupsByKey = new Map(groups.map((group) => [group.key, group]));
    const result = new Map<string, { group: CursorWorkspaceGroup; thread: CursorThreadSummary }>();
    for (const [groupKey, threads] of threadsByKey) {
        const group = groupsByKey.get(groupKey);
        if (group) {
            for (const thread of threads) {
                result.set(thread.composerId, { group, thread });
            }
        }
    }
    return result;
};

const assembleDiscovery = (
    resolved: ResolvedThread[],
    bucketGroups: CursorWorkspaceGroup[],
    fileHistoryActivity: Map<string, number>,
): CursorDiscovery => {
    const threadsByKey = new Map<string, CursorThreadSummary[]>();
    const lastActiveByKey = new Map<string, number>();

    const groupLabels = new Map(bucketGroups.map((group) => [group.key, group.label]));
    for (const thread of resolved.filter(shouldIncludeResolvedThread)) {
        const list = threadsByKey.get(thread.groupKey) ?? [];
        list.push(
            toThreadSummary({
                ...thread,
                groupLabel: groupLabels.get(thread.groupKey) ?? thread.groupLabel,
            }),
        );
        threadsByKey.set(thread.groupKey, list);
        lastActiveByKey.set(
            thread.groupKey,
            Math.max(lastActiveByKey.get(thread.groupKey) ?? 0, thread.lastUpdatedAtMs ?? 0),
        );
    }

    for (const [folder, lastActiveMs] of fileHistoryActivity) {
        const key = `folder:${folder}`;
        lastActiveByKey.set(key, Math.max(lastActiveByKey.get(key) ?? 0, lastActiveMs));
    }

    for (const list of threadsByKey.values()) {
        list.sort((a, b) => (b.lastUpdatedAtMs ?? 0) - (a.lastUpdatedAtMs ?? 0));
    }

    const groups = buildDiscoveryGroups(threadsByKey, bucketGroups, lastActiveByKey);
    const threadsByComposerId = indexThreadsByComposerId(groups, threadsByKey);
    return { groups, threadsByComposerId, threadsByKey };
};

const mergeBucketGroup = (
    bucketGroup: CursorWorkspaceGroup,
    threadsByKey: Map<string, CursorThreadSummary[]>,
    lastActiveByKey: Map<string, number>,
): CursorWorkspaceGroup => {
    const threads = threadsByKey.get(bucketGroup.key) ?? [];
    return {
        ...bucketGroup,
        lastActiveMs: Math.max(bucketGroup.lastActiveMs, lastActiveByKey.get(bucketGroup.key) ?? 0),
        threadCount: threads.length || bucketGroup.threadCount,
    };
};

const buildBucketlessGroup = (key: string, threadCount: number, lastActiveMs: number): CursorWorkspaceGroup => {
    const isUnknown = key === UNKNOWN_GROUP_KEY;
    const folder = isUnknown ? '' : key.slice('folder:'.length);
    return {
        buckets: [],
        folders: folder ? [folder] : [],
        key,
        kind: isUnknown ? 'unknown' : 'folder',
        label: isUnknown ? 'Unknown project' : path.basename(folder),
        lastActiveMs,
        needsRecovery: false,
        threadCount,
        uri: folder ? toFileUri(folder) : '',
    };
};

const buildDiscoveryGroups = (
    threadsByKey: Map<string, CursorThreadSummary[]>,
    bucketGroups: CursorWorkspaceGroup[],
    lastActiveByKey: Map<string, number>,
): CursorWorkspaceGroup[] => {
    const seen = new Set(bucketGroups.map((group) => group.key));
    const groups = bucketGroups.map((group) => mergeBucketGroup(group, threadsByKey, lastActiveByKey));

    const keys = new Set([...threadsByKey.keys(), ...lastActiveByKey.keys()]);
    for (const key of keys) {
        const threads = threadsByKey.get(key) ?? [];
        if (!seen.has(key) && (threads.length > 0 || key !== UNKNOWN_GROUP_KEY)) {
            groups.push(buildBucketlessGroup(key, threads.length, lastActiveByKey.get(key) ?? 0));
            seen.add(key);
        }
    }

    return groups.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
};

const buildDiscovery = async (userDir: string, options: CursorDiscoveryOptions = {}): Promise<CursorDiscovery> => {
    const buckets = await (options.strict ? loadCursorBucketsStrict(userDir) : loadCursorBuckets(userDir));
    const bucketGroups = groupCursorBuckets(buckets);
    const globalDbPath = getCursorGlobalDbPath(userDir);
    const cliThreads = await readCursorCliTranscriptThreads(userDir, options);

    if (!(await pathExists(globalDbPath))) {
        return assembleDiscovery(cliThreads, bucketGroups, new Map());
    }

    const bucketIdToGroupKey = new Map<string, string>();
    const bucketIdToFolder = new Map<string, string | null>();
    for (const group of bucketGroups) {
        for (const bucket of group.buckets) {
            bucketIdToGroupKey.set(bucket.bucketId, group.key);
            bucketIdToFolder.set(bucket.bucketId, group.folders[0] ?? null);
        }
    }

    const databaseResult = withCursorReadonlyDb(globalDbPath, (db) => {
        const heads = readAllHeads(db, options);
        if (options.updatedAfterMs !== undefined && heads.size === 0) {
            return { kind: 'empty' as const };
        }

        const headerInfo = readHeaderInfo(globalDbPath, options.strict);
        const bucketComposerIds =
            options.updatedAfterMs === undefined ? collectBucketComposerIds(buckets, options.strict) : new Map();
        const universe =
            options.updatedAfterMs === undefined
                ? new Set<string>([...heads.keys(), ...headerInfo.keys(), ...bucketComposerIds.keys()])
                : new Set<string>(heads.keys());
        const resolved: ResolvedThread[] = [];

        for (const composerId of universe) {
            resolved.push(
                resolveThreadFolder(
                    composerId,
                    heads.get(composerId),
                    headerInfo.get(composerId),
                    { bytes: 0, count: 0 },
                    bucketIdToGroupKey,
                    bucketIdToFolder,
                    bucketComposerIds,
                    db,
                ),
            );
        }

        const knownComposerIds = new Set(universe);
        return { kind: 'resolved' as const, knownComposerIds, resolved };
    });

    if (databaseResult.kind === 'empty') {
        return assembleDiscovery(cliThreads, bucketGroups, new Map());
    }

    const fileHistoryActivity =
        options.updatedAfterMs === undefined ? await readCursorFileHistoryProjectActivity(userDir) : new Map();
    return assembleDiscovery(
        [
            ...databaseResult.resolved,
            ...cliThreads.filter((thread) => !databaseResult.knownComposerIds.has(thread.composerId)),
        ],
        bucketGroups,
        fileHistoryActivity,
    );
};

const discoverCursorWorkspaces = async (
    userDir: string,
    options: CursorDiscoveryOptions = {},
): Promise<CursorDiscovery> => {
    if (options.updatedAfterMs !== undefined || options.strict) {
        return await buildDiscovery(userDir, options);
    }

    const now = Date.now();
    for (const [key, entry] of discoveryCache) {
        if (now - entry.at >= DISCOVERY_TTL_MS) {
            discoveryCache.delete(key);
        }
    }
    const cached = discoveryCache.get(userDir);
    if (cached) {
        discoveryCache.delete(userDir);
        discoveryCache.set(userDir, cached);
        return cached.value;
    }

    const pending = discoveryInFlight.get(userDir);
    if (pending) {
        return pending;
    }

    const generation = discoveryGeneration;
    const load = buildDiscovery(userDir);
    discoveryInFlight.set(userDir, load);
    try {
        const value = await load;
        if (generation === discoveryGeneration) {
            while (discoveryCache.size >= DISCOVERY_CACHE_MAX_ENTRIES) {
                const oldestKey = discoveryCache.keys().next().value;
                if (typeof oldestKey !== 'string') {
                    break;
                }
                discoveryCache.delete(oldestKey);
            }
            discoveryCache.set(userDir, { at: Date.now(), value });
        }
        return value;
    } finally {
        if (discoveryInFlight.get(userDir) === load) {
            discoveryInFlight.delete(userDir);
        }
    }
};

const readCursorThreadHeadFromDb = (db: Database, composerId: string): CursorThreadHead | null => {
    const head = readKvValue<Record<string, JsonValue>>(db, `composerData:${composerId}`);
    if (!head) {
        return null;
    }

    const headerList = Array.isArray(head.fullConversationHeadersOnly)
        ? (head.fullConversationHeadersOnly as JsonValue[])
        : [];
    const orderedBubbleIds = headerList
        .map((item) => asString(asObject(item)?.bubbleId ?? null))
        .filter((value): value is string => Boolean(value));

    return {
        composerId,
        createdAtMs: asNumber(head.createdAt ?? null),
        lastUpdatedAtMs: asNumber(head.lastUpdatedAt ?? null),
        mode: asString(head.unifiedMode ?? null),
        model: parseGlobalHead(JSON.stringify(head)).model,
        name: asString(head.name ?? null),
        orderedBubbleIds,
        totalBubbleHeaders: headerList.length,
    };
};

export const readCursorThreadHead = (globalDbPath: string, composerId: string): CursorThreadHead | null =>
    withCursorReadonlyDb(globalDbPath, (db) => readCursorThreadHeadFromDb(db, composerId));

const toBubbleKind = (rawType: JsonValue): CursorBubbleKind => {
    if (rawType === 1) {
        return 'user';
    }

    if (rawType === 2) {
        return 'assistant';
    }

    return 'unknown';
};

const parseToolCall = (raw: JsonValue): CursorToolCall | null => {
    const data = asObject(raw);
    if (!data) {
        return null;
    }

    const name = asString(data.name ?? null);
    if (!name) {
        return null;
    }

    return {
        argumentsText: asString(data.rawArgs ?? null) ?? asString(data.params ?? null),
        callId: asString(data.toolCallId ?? null),
        name,
        resultText: asString(data.result ?? null),
        status: asString(data.status ?? null),
    };
};

export const parseCursorBubble = (bubbleId: string, raw: Record<string, JsonValue>): CursorBubble => {
    const thinking = asObject(raw.thinking ?? null);

    return {
        bubbleId,
        createdAtMs: asNumber(raw.createdAt ?? null),
        kind: toBubbleKind(raw.type ?? null),
        text: asString(raw.text ?? null) ?? '',
        thinking: thinking ? asString(thinking.text ?? null) : null,
        toolCall: parseToolCall(raw.toolFormerData ?? null),
    };
};

const readBubble = (db: Database, composerId: string, bubbleId: string): CursorBubble | null => {
    const raw = readKvValue<Record<string, JsonValue>>(db, `bubbleId:${composerId}:${bubbleId}`);
    if (!raw) {
        return null;
    }

    return parseCursorBubble(bubbleId, raw);
};

const isRenderableBubble = (bubble: CursorBubble): boolean => {
    return Boolean(bubble.text.trim() || bubble.thinking?.trim() || bubble.toolCall);
};

const normalizeBubbleText = (value: string | null): string => {
    return (value ?? '').replace(/\s+/gu, ' ').trim();
};

const hashText = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 12);

const stableStringifyJson = (value: JsonValue): string => {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringifyJson).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringifyJson((value as Record<string, JsonValue>)[key]!)}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
};

const normalizeToolArgumentsText = (value: string | null): string => {
    if (!value?.trim()) {
        return '';
    }

    try {
        return stableStringifyJson(JSON.parse(value) as JsonValue);
    } catch {
        return normalizeBubbleText(value);
    }
};

const hasRenderableTextSuperset = (left: string | null, right: string | null): boolean => {
    const normalizedLeft = normalizeBubbleText(left);
    const normalizedRight = normalizeBubbleText(right);
    if (!normalizedLeft && !normalizedRight) {
        return true;
    }

    return (
        normalizedLeft === normalizedRight ||
        normalizedLeft.startsWith(normalizedRight) ||
        normalizedRight.startsWith(normalizedLeft)
    );
};

const haveSameToolIdentity = (left: CursorToolCall | null, right: CursorToolCall | null): boolean => {
    if (!left && !right) {
        return true;
    }

    if (!left || !right) {
        return false;
    }

    return (
        left.name === right.name &&
        normalizeToolArgumentsText(left.argumentsText) === normalizeToolArgumentsText(right.argumentsText)
    );
};

const areEquivalentBubbles = (left: CursorBubble, right: CursorBubble): boolean => {
    return (
        left.kind === right.kind &&
        hasRenderableTextSuperset(left.text, right.text) &&
        Boolean(normalizeBubbleText(left.thinking)) === Boolean(normalizeBubbleText(right.thinking)) &&
        haveSameToolIdentity(left.toolCall, right.toolCall)
    );
};

const hasEquivalentBubble = (bubbles: CursorBubble[], candidate: CursorBubble): boolean => {
    return bubbles.some((bubble) => areEquivalentBubbles(bubble, candidate));
};

const findAgentTailStartIndex = (existingBubbles: CursorBubble[], agentBubbles: CursorBubble[]): number => {
    // Agent transcript files can replay a run after SQLite already contains its final answer.
    for (let index = agentBubbles.length - 1; index >= 0; index -= 1) {
        if (hasEquivalentBubble(existingBubbles, agentBubbles[index]!)) {
            return index + 1;
        }
    }

    return 0;
};

const getAgentTranscriptContentParts = (entry: Record<string, JsonValue>): Record<string, JsonValue>[] => {
    const message = asObject(entry.message ?? null);
    const content = message?.content ?? entry.content ?? null;
    if (Array.isArray(content)) {
        return content.map((part) => asObject(part)).filter((part): part is Record<string, JsonValue> => Boolean(part));
    }

    if (typeof content === 'string') {
        return [{ text: content, type: 'text' }];
    }

    return [];
};

const parseAgentTranscriptToolCall = (parts: Record<string, JsonValue>[]): CursorToolCall | null => {
    const toolUse = parts.find((part) => asString(part.type ?? null) === 'tool_use');
    if (!toolUse) {
        return null;
    }

    const name = asString(toolUse.name ?? null);
    if (!name) {
        return null;
    }

    return {
        argumentsText: toolUse.input === undefined ? null : JSON.stringify(toolUse.input),
        callId: asString(toolUse.id ?? null),
        name,
        resultText: null,
        status: null,
    };
};

const parseAgentTranscriptBubble = (
    filePath: string,
    lineNumber: number,
    raw: Record<string, JsonValue>,
): CursorBubble | null => {
    const message = asObject(raw.message ?? null);
    const role = asString(raw.role ?? message?.role ?? null);
    const kind = role === 'user' || role === 'assistant' ? role : 'unknown';
    const parts = getAgentTranscriptContentParts(raw);
    const text = parts
        .filter((part) => asString(part.type ?? null) === 'text')
        .map((part) => asString(part.text ?? null))
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n\n');
    const toolCall = parseAgentTranscriptToolCall(parts);
    const bubble: CursorBubble = {
        bubbleId: `agent-transcript:${hashText(path.resolve(filePath))}:${path.basename(filePath)}:${lineNumber}`,
        createdAtMs: null,
        kind,
        text,
        thinking: null,
        toolCall,
    };

    return isRenderableBubble(bubble) ? bubble : null;
};

const parseCursorAgentTranscriptLine = (filePath: string, line: string, lineNumber: number): CursorBubble | null => {
    if (!line.trim()) {
        return null;
    }

    let raw: JsonValue;
    try {
        raw = JSON.parse(line) as JsonValue;
    } catch (error) {
        warnCursorDataIssue('invalid_agent_transcript_jsonl', {
            error: error instanceof Error ? error.message : String(error),
            filePath,
            lineNumber,
        });
        return null;
    }

    const entry = asObject(raw);
    return entry ? parseAgentTranscriptBubble(filePath, lineNumber, entry) : null;
};

const readCursorAgentTranscriptFile = async (filePath: string): Promise<CursorBubble[]> => {
    const bubbles: CursorBubble[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({
        crlfDelay: Number.POSITIVE_INFINITY,
        input: stream,
    });
    let lineNumber = 0;

    try {
        for await (const line of lines) {
            lineNumber += 1;
            const bubble = parseCursorAgentTranscriptLine(filePath, line, lineNumber);
            if (bubble) {
                bubbles.push(bubble);
            }
        }
    } catch (error) {
        bubbles.length = 0;
        warnCursorDataIssue('agent_transcript_unreadable', {
            error: error instanceof Error ? error.message : String(error),
            filePath,
        });
    } finally {
        lines.close();
        stream.destroy();
    }

    return bubbles;
};

const listCursorAgentTranscriptFiles = async (transcriptDir: string, composerId: string): Promise<string[]> => {
    const preferred = path.join(transcriptDir, `${composerId}.jsonl`);
    const files = new Set<string>();
    if (await pathExists(preferred)) {
        files.add(preferred);
    }

    let entries: string[] = [];
    try {
        entries = await readdir(transcriptDir);
    } catch {
        return [...files];
    }

    for (const entry of entries) {
        if (entry.endsWith('.jsonl')) {
            files.add(path.join(transcriptDir, entry));
        }
    }

    return [...files].sort();
};

type CursorAgentTranscript = {
    bubbles: CursorBubble[];
    bytes: number;
    createdAtMs: number | null;
    lastUpdatedAtMs: number | null;
};

const readCursorAgentTranscript = async (
    composerId: string,
    userDir: string,
    transcriptDirs?: string[],
): Promise<CursorAgentTranscript> => {
    const resolvedTranscriptDirs = transcriptDirs ?? (await findCursorTranscriptDirs(composerId, userDir));
    const bubbles: CursorBubble[] = [];
    let bytes = 0;
    let createdAtMs: number | null = null;
    let lastUpdatedAtMs: number | null = null;
    for (const transcriptDir of [...resolvedTranscriptDirs].sort()) {
        const files = await listCursorAgentTranscriptFiles(transcriptDir, composerId);
        for (const file of files) {
            let fileStat: Awaited<ReturnType<typeof stat>>;
            try {
                fileStat = await stat(file);
            } catch {
                continue;
            }

            bytes += fileStat.size;
            if (fileStat.birthtimeMs > 0 && (createdAtMs === null || fileStat.birthtimeMs < createdAtMs)) {
                createdAtMs = fileStat.birthtimeMs;
            }
            lastUpdatedAtMs = Math.max(lastUpdatedAtMs ?? 0, fileStat.mtimeMs);
            bubbles.push(...(await readCursorAgentTranscriptFile(file)));
        }
    }

    return { bubbles, bytes, createdAtMs, lastUpdatedAtMs };
};

const getNewestCursorTranscriptMtimeMs = async (transcriptDir: string, composerId: string): Promise<number> => {
    let newestMtimeMs = 0;
    for (const file of await listCursorAgentTranscriptFiles(transcriptDir, composerId)) {
        try {
            newestMtimeMs = Math.max(newestMtimeMs, (await stat(file)).mtimeMs);
        } catch {
            // The transcript may disappear while Cursor is writing it; the normal reader handles that race.
        }
    }
    return newestMtimeMs;
};

const readCursorProjectWorkspacePath = async (projectDir: string): Promise<string | null> => {
    try {
        const data = (await Bun.file(path.join(projectDir, '.workspace-trusted')).json()) as {
            workspacePath?: unknown;
        };
        return typeof data.workspacePath === 'string' ? normalizeCursorPath(data.workspacePath) || null : null;
    } catch {
        return null;
    }
};

const getCursorAgentThreadName = (bubbles: CursorBubble[]): string => {
    const firstUserBubble = bubbles.find((bubble) => bubble.kind === 'user' && bubble.text.trim());
    const raw = firstUserBubble?.text ?? '';
    const query = raw.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/u)?.[1] ?? raw;
    return normalizeBubbleText(query).slice(0, 200) || '(untitled)';
};

type CursorDirectoryEntry = { isDirectory: () => boolean; name: string };

const readCursorDirectoryEntries = async (directory: string): Promise<CursorDirectoryEntry[]> => {
    try {
        return await readdir(directory, { withFileTypes: true });
    } catch {
        return [];
    }
};

const isCursorCliTranscriptAfterUpdate = (transcript: CursorAgentTranscript, updatedAfterMs?: number): boolean => {
    return updatedAfterMs === undefined || (transcript.lastUpdatedAtMs ?? 0) > updatedAfterMs;
};

const readCursorCliTranscriptThread = async (
    userDir: string,
    agentTranscriptsDir: string,
    workspacePath: string | null,
    transcriptEntry: CursorDirectoryEntry,
    options: CursorDiscoveryOptions,
): Promise<ResolvedThread | null> => {
    if (!transcriptEntry.isDirectory() || !isSafeCursorComposerId(transcriptEntry.name)) {
        return null;
    }

    const transcriptDir = path.join(agentTranscriptsDir, transcriptEntry.name);
    if (
        options.updatedAfterMs !== undefined &&
        (await getNewestCursorTranscriptMtimeMs(transcriptDir, transcriptEntry.name)) <= options.updatedAfterMs
    ) {
        return null;
    }
    const transcript = await readCursorAgentTranscript(transcriptEntry.name, userDir, [transcriptDir]);
    if (transcript.bubbles.length === 0 || !isCursorCliTranscriptAfterUpdate(transcript, options.updatedAfterMs)) {
        return null;
    }

    const folder = workspacePath;
    return {
        bucketId: null,
        composerId: transcriptEntry.name,
        createdAtMs: transcript.createdAtMs,
        folder,
        groupKey: folder ? `folder:${folder}` : UNKNOWN_GROUP_KEY,
        groupLabel: folder ? path.basename(folder) : 'Unknown project',
        lastUpdatedAtMs: transcript.lastUpdatedAtMs,
        mode: null,
        model: null,
        name: getCursorAgentThreadName(transcript.bubbles),
        parentComposerId: null,
        reasoningEffort: null,
        stat: { bytes: transcript.bytes, count: transcript.bubbles.length },
        status: null,
    };
};

const keepNewestCursorCliThread = (threadsById: Map<string, ResolvedThread>, candidate: ResolvedThread): void => {
    const existing = threadsById.get(candidate.composerId);
    if (!existing || (candidate.lastUpdatedAtMs ?? 0) > (existing.lastUpdatedAtMs ?? 0)) {
        threadsById.set(candidate.composerId, candidate);
    }
};

const readCursorCliTranscriptThreads = async (
    userDir: string,
    options: CursorDiscoveryOptions,
): Promise<ResolvedThread[]> => {
    const projectsDir = getCursorProjectsDir(userDir);
    const projectEntries = (await readCursorDirectoryEntries(projectsDir)).filter((entry) => entry.isDirectory());
    const threadsById = new Map<string, ResolvedThread>();
    for (const projectEntry of projectEntries) {
        const projectDir = path.join(projectsDir, projectEntry.name);
        const agentTranscriptsDir = path.join(projectDir, 'agent-transcripts');
        const workspacePath = await readCursorProjectWorkspacePath(projectDir);
        for (const transcriptEntry of await readCursorDirectoryEntries(agentTranscriptsDir)) {
            const candidate = await readCursorCliTranscriptThread(
                userDir,
                agentTranscriptsDir,
                workspacePath,
                transcriptEntry,
                options,
            );
            if (candidate) {
                keepNewestCursorCliThread(threadsById, candidate);
            }
        }
    }

    return [...threadsById.values()];
};

const mergeAgentTranscriptTail = (
    transcript: CursorThreadTranscript,
    agentBubbles: CursorBubble[],
): CursorThreadTranscript => {
    const tailStartIndex = findAgentTailStartIndex(transcript.bubbles, agentBubbles);
    const seen = [...transcript.bubbles];
    const appended: CursorBubble[] = [];
    const candidates = agentBubbles.slice(tailStartIndex);
    for (const bubble of candidates) {
        if (hasEquivalentBubble(seen, bubble)) {
            continue;
        }

        seen.push(bubble);
        appended.push(bubble);
    }

    if (appended.length === 0) {
        return transcript;
    }

    return {
        ...transcript,
        bubbles: [...transcript.bubbles, ...appended],
        renderableBubbleCount: transcript.renderableBubbleCount + appended.length,
    };
};

const inferCursorUserDirFromGlobalDbPath = (globalDbPath: string): string => {
    const globalStorageDir = path.dirname(globalDbPath);
    return path.basename(globalStorageDir) === 'globalStorage'
        ? path.dirname(globalStorageDir)
        : resolveCursorUserDir();
};

export const readCursorThreadTranscript = (globalDbPath: string, composerId: string): CursorThreadTranscript | null => {
    return withCursorReadonlyDb(globalDbPath, (db) => {
        const head = readCursorThreadHeadFromDb(db, composerId);
        if (!head) {
            return null;
        }

        const orderedIds = head.orderedBubbleIds.length > 0 ? head.orderedBubbleIds : readAllBubbleIds(db, composerId);
        const bubbles: CursorBubble[] = [];
        for (const bubbleId of orderedIds) {
            const bubble = readBubble(db, composerId, bubbleId);
            if (bubble && isRenderableBubble(bubble)) {
                bubbles.push(bubble);
            }
        }

        // Cursor caps very long threads' header index; stored bubbles beyond the index can't be ordered.
        const totalBubbleRows = countBubbles(db, composerId).count;
        const omittedBubbleCount = Math.max(totalBubbleRows - orderedIds.length, 0);

        return {
            bubbles,
            head,
            omittedBubbleCount,
            renderableBubbleCount: bubbles.length,
        };
    });
};

export const readCursorThreadTranscriptWithAgentFiles = async (
    globalDbPath: string,
    composerId: string,
    userDir = inferCursorUserDirFromGlobalDbPath(globalDbPath),
    transcriptDirs?: string[],
): Promise<CursorThreadTranscript | null> => {
    const transcript = (await pathExists(globalDbPath)) ? readCursorThreadTranscript(globalDbPath, composerId) : null;
    const resolvedTranscriptDirs = transcriptDirs ?? (await findCursorTranscriptDirs(composerId, userDir));
    const [agentTranscript, model] = await Promise.all([
        readCursorAgentTranscript(composerId, userDir, resolvedTranscriptDirs),
        readCursorChatStoreModel(composerId, resolvedTranscriptDirs),
    ]);
    let mergedTranscript: CursorThreadTranscript;
    if (!transcript) {
        if (agentTranscript.bubbles.length === 0) {
            return null;
        }

        mergedTranscript = {
            bubbles: agentTranscript.bubbles,
            head: {
                composerId,
                createdAtMs: agentTranscript.createdAtMs,
                lastUpdatedAtMs: agentTranscript.lastUpdatedAtMs,
                mode: null,
                name: getCursorAgentThreadName(agentTranscript.bubbles),
                orderedBubbleIds: agentTranscript.bubbles.map((bubble) => bubble.bubbleId),
                totalBubbleHeaders: agentTranscript.bubbles.length,
            },
            omittedBubbleCount: 0,
            renderableBubbleCount: agentTranscript.bubbles.length,
        };
    } else {
        mergedTranscript = mergeAgentTranscriptTail(transcript, agentTranscript.bubbles);
    }

    return model ? { ...mergedTranscript, head: { ...mergedTranscript.head, model: model.model } } : mergedTranscript;
};

const readAllBubbleIds = (db: Database, composerId: string): string[] => {
    const prefix = `bubbleId:${composerId}:`;
    const range = getCursorBubbleKeyRange(composerId);
    const rows = db
        .query('SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ? ORDER BY rowid ASC')
        .all(range.start, range.end) as Array<{ key: string; value: string }>;
    return rows
        .filter((row) => isCursorBubbleKeyForComposer(row.key, row.value, composerId))
        .map((row) => row.key.slice(prefix.length));
};
