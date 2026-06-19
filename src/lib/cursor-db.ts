import { constants, Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
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
import { asNumber, asObject, asString, type JsonValue } from './shared';

type ComposerEntry = Record<string, JsonValue> & {
    composerId?: string;
    name?: string;
    workspaceIdentifier?: { id?: string } | null;
};

export const CURSOR_READONLY_DB_OPEN_FLAGS = constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI;

// Cursor databases are WAL-mode. A plain read-only open fails once Cursor cleanly shuts down and
// removes the -wal/-shm sidecars, and the failure only surfaces at query time (so a try/catch around
// the constructor never sees it). immutable=1 reads the main database file directly, which works
// whether or not Cursor is running and whether or not the WAL sidecars are present. The explicit URI
// flag keeps this portable across SQLite builds where URI filename parsing is not enabled globally.
export const getCursorReadonlyDbUri = (dbPath: string): string => {
    const normalizedPath = dbPath.replace(/\\/gu, '/');
    const absolutePath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
    const encodedPath = absolutePath
        .split('/')
        .map((segment) => (/^[A-Za-z]:$/u.test(segment) ? segment : encodeURIComponent(segment)))
        .join('/');

    return `file://${encodedPath}?immutable=1`;
};

export const openCursorReadonlyDb = (dbPath: string): Database => {
    return new Database(getCursorReadonlyDbUri(dbPath), CURSOR_READONLY_DB_OPEN_FLAGS);
};

const pathExists = async (target: string): Promise<boolean> => {
    try {
        await stat(target);
        return true;
    } catch {
        return false;
    }
};

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
        return decodeURIComponent(uri.slice('file://'.length));
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
        warnCursorDataIssue('invalid_code_workspace_json', {
            error: error instanceof Error ? error.message : String(error),
            workspaceFilePath,
        });
        return [];
    }
};

export const loadGlobalComposerHeaders = (globalDbPath: string): ComposerEntry[] => {
    try {
        const db = openCursorReadonlyDb(globalDbPath);
        try {
            const data = readItemValue<{ allComposers?: ComposerEntry[] }>(db, COMPOSER_HEADERS_KEY);
            return data?.allComposers ?? [];
        } finally {
            db.close();
        }
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

const readBucketComposerIds = (dbPath: string): string[] => {
    try {
        const db = openCursorReadonlyDb(dbPath);
        try {
            const data = readItemValue<{ allComposers?: ComposerEntry[] }>(db, COMPOSER_DATA_KEY);
            return (data?.allComposers ?? [])
                .map((entry) => entry.composerId)
                .filter((value): value is string => Boolean(value));
        } finally {
            db.close();
        }
    } catch {
        return [];
    }
};

export const loadCursorBuckets = async (userDir = resolveCursorUserDir()): Promise<CursorWorkspaceBucket[]> => {
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
        for (const header of loadGlobalComposerHeaders(globalDbPath)) {
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
        const bucket = await buildBucket(workspaceStorageDir, bucketId, headerIdsByBucket);
        if (bucket) {
            buckets.push(bucket);
        }
    }

    return buckets;
};

const buildBucket = async (
    workspaceStorageDir: string,
    bucketId: string,
    headerIdsByBucket: Map<string, Set<string>>,
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
        composerIds = readBucketComposerIds(dbPath);
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
    const row = db
        .query('SELECT COUNT(*) AS count, COALESCE(SUM(length(value)), 0) AS bytes FROM cursorDiskKV WHERE key LIKE ?')
        .get(`bubbleId:${composerId}:%`) as { count: number; bytes: number };
    return { bytes: row.bytes, count: row.count };
};

export const findCursorTranscriptDirs = async (
    composerId: string,
    userDir = resolveCursorUserDir(),
): Promise<string[]> => {
    const projectsDir = getCursorProjectsDir(userDir);
    if (!(await pathExists(projectsDir))) {
        return [];
    }

    const matches: string[] = [];
    let projectDirs: string[] = [];
    try {
        projectDirs = await readdir(projectsDir);
    } catch {
        return [];
    }

    for (const projectDir of projectDirs) {
        const transcriptDir = path.join(projectsDir, projectDir, 'agent-transcripts', composerId);
        if (await pathExists(transcriptDir)) {
            matches.push(transcriptDir);
        }
    }

    return matches;
};

export type ListCursorThreadsOptions = {
    includeTranscriptDirs?: boolean;
    updatedAfterMs?: number;
};

export const listCursorThreadsForGroup = async (
    group: CursorWorkspaceGroup,
    userDir = resolveCursorUserDir(),
    options: ListCursorThreadsOptions = {},
): Promise<CursorThreadSummary[]> => {
    const discovery = await discoverCursorWorkspaces(userDir, options);
    const threads = discovery.threadsByKey.get(group.key) ?? [];

    if (options.includeTranscriptDirs === false) {
        return threads;
    }

    return Promise.all(
        threads.map(async (thread) => ({
            ...thread,
            transcriptDirs: await findCursorTranscriptDirs(thread.composerId, userDir),
        })),
    );
};

// Older threads' workspace buckets get pruned by Cursor over time, and many threads predate the
// workspace-linking migration, so a bucket-only walk hides large amounts of history. Discovery
// instead enumerates every thread in the global store and resolves each to a folder via (in order):
// its global header workspace uri, an existing bucket it points at, or — for threads with no such
// link — the dominant absolute path found in its tool calls.

type GlobalHead = {
    name: string | null;
    createdAtMs: number | null;
    lastUpdatedAtMs: number | null;
    mode: string | null;
    pathHint: string | null;
};
type HeaderInfo = { name: string | null; uriPath: string | null; bucketId: string | null };
type BubbleStat = { count: number; bytes: number };

type CursorDiscovery = {
    groups: CursorWorkspaceGroup[];
    threadsByKey: Map<string, CursorThreadSummary[]>;
};

type CursorDiscoveryOptions = {
    updatedAfterMs?: number;
};

// Discovery does a full scan of the (potentially multi-GB) global DB, so cache it briefly. Writes
// (recover/prune/delete) call invalidateCursorDiscoveryCache() so the UI never shows stale results.
const DISCOVERY_TTL_MS = 60_000;
const UNKNOWN_GROUP_KEY = 'unknown';
let discoveryCache: { userDir: string; at: number; value: CursorDiscovery } | null = null;

export const invalidateCursorDiscoveryCache = (): void => {
    discoveryCache = null;
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
const REVERSE_WORKSPACE_ROOT_RE = /^\/Users\/[^/]+\/workspace\/reverse\/[^/]+/u;
const CONTAINER_ROOT_RE = new RegExp(`^(/Users/[^/]+/(?:${DEV_CONTAINER_DIRS.join('|')})/[^/]+)`);
const ABS_PATH_RE = /\/Users\/[^"'\s:,)\]]+/g;

const isNoisePath = (value: string): boolean =>
    /\/Library(?:\/|$)|\/\.cursor(?:\/|$)|\/node_modules\/|\/\.git\/|^\/tmp|^\/var|^\/private|\/\.Trash\//u.test(
        value,
    ) || /^\/Users\/[^/]+\/(?:Downloads|Desktop)$/u.test(value);

const stripLikelyFileName = (value: string): string => {
    const basename = path.basename(value);
    return basename.includes('.') ? path.dirname(value) : value;
};

const containerRootFromPath = (value: string): string | null => {
    const candidate = stripLikelyFileName(normalizeCursorPath(value));
    const reverseMatch = candidate.match(REVERSE_WORKSPACE_ROOT_RE);
    if (reverseMatch) {
        return reverseMatch[0] ?? null;
    }

    const match = candidate.match(CONTAINER_ROOT_RE);
    if (match) {
        return match[1] ?? null;
    }

    const parts = candidate.split('/');
    if (parts.length >= 4 && parts[1] === 'Users') {
        return `/${parts.slice(1, 4).join('/')}`;
    }

    return null;
};

const inferFolderFromPaths = (paths: string[]): string | null => {
    const counts = new Map<string, number>();
    for (const value of paths) {
        if (isNoisePath(value)) {
            continue;
        }

        const root = containerRootFromPath(value);
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

        const entriesPath = path.join(historyDir, entry.name, 'entries.json');
        let data: { resource?: string; entries?: Array<{ timestamp?: number }> };
        try {
            data = (await Bun.file(entriesPath).json()) as {
                resource?: string;
                entries?: Array<{ timestamp?: number }>;
            };
        } catch {
            continue;
        }

        const resource = typeof data.resource === 'string' ? data.resource : '';
        const folder = containerRootFromPath(resource);
        if (!folder || isNoisePath(folder)) {
            continue;
        }

        const lastActiveMs = Math.max(0, ...(data.entries ?? []).map((item) => item.timestamp ?? 0));
        activity.set(folder, Math.max(activity.get(folder) ?? 0, lastActiveMs));
    }

    return activity;
};

const inferFolderFromBubbles = (db: Database, composerId: string): string | null => {
    const rows = db
        .query('SELECT value FROM cursorDiskKV WHERE key LIKE ? LIMIT 80')
        .all(`bubbleId:${composerId}:%`) as Array<{ value: string }>;
    const paths: string[] = [];

    for (const { value } of rows) {
        let bubble: Record<string, JsonValue>;
        try {
            bubble = JSON.parse(value) as Record<string, JsonValue>;
        } catch {
            continue;
        }

        const tool = asObject(bubble.toolFormerData ?? null);
        if (!tool) {
            continue;
        }

        const blob = `${asString(tool.rawArgs ?? null) ?? ''} ${asString(tool.params ?? null) ?? ''}`;
        const matches = blob.match(ABS_PATH_RE);
        if (matches) {
            paths.push(...matches);
        }

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
            .all(options.updatedAfterMs) as Array<{ id: string; value: string }>;

        return new Map(rows.map((row) => [row.id, parseGlobalHead(row.value)]));
    }

    const rows = db
        .query(`SELECT substr(key, 14) AS id, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
        .all() as Array<{ id: string; value: string }>;

    return new Map(rows.map((row) => [row.id, parseGlobalHead(row.value)]));
};

const parseGlobalHead = (value: string): GlobalHead => {
    let parsed: Record<string, JsonValue> = {};
    try {
        parsed = JSON.parse(value) as Record<string, JsonValue>;
    } catch {
        return {
            createdAtMs: null,
            lastUpdatedAtMs: null,
            mode: null,
            name: null,
            pathHint: inferFolderFromBlob(value),
        };
    }

    return {
        createdAtMs: asNumber(parsed.createdAt ?? null),
        lastUpdatedAtMs: asNumber(parsed.lastUpdatedAt ?? null),
        mode: asString(parsed.unifiedMode ?? null),
        name: asString(parsed.name ?? null),
        pathHint: inferFolderFromBlob(value),
    };
};

const readBubbleStats = (db: Database, composerIds?: Iterable<string>): Map<string, BubbleStat> => {
    const ids = composerIds ? [...composerIds] : null;
    if (ids?.length === 0) {
        return new Map();
    }

    // Keys are `bubbleId:<composerId>:<bubbleId>`; composer ids contain no colon, so slice up to the
    // next ':' rather than assuming a fixed UUID length (keeps tests and any id format working).
    const query =
        ids === null
            ? `SELECT substr(key, 10, instr(substr(key, 10), ':') - 1) AS id,
                    COUNT(*) AS count,
                    COALESCE(SUM(length(value)), 0) AS bytes
             FROM cursorDiskKV WHERE key GLOB 'bubbleId:*:*' GROUP BY id`
            : `SELECT substr(key, 10, instr(substr(key, 10), ':') - 1) AS id,
                    COUNT(*) AS count,
                    COALESCE(SUM(length(value)), 0) AS bytes
             FROM cursorDiskKV
             WHERE key GLOB 'bubbleId:*:*'
                AND substr(key, 10, instr(substr(key, 10), ':') - 1) IN (${ids.map(() => '?').join(',')})
             GROUP BY id`;
    const rows = db.query(query).all(...(ids ?? [])) as Array<{ id: string; count: number; bytes: number }>;

    return new Map(rows.map((row) => [row.id, { bytes: row.bytes, count: row.count }]));
};

const readHeaderInfo = (globalDbPath: string): Map<string, HeaderInfo> => {
    const info = new Map<string, HeaderInfo>();
    for (const header of loadGlobalComposerHeaders(globalDbPath)) {
        if (!header.composerId) {
            continue;
        }

        const identifier = header.workspaceIdentifier as
            | { id?: string; uri?: { path?: string; fsPath?: string } }
            | undefined;
        const uriPath = identifier?.uri?.path ?? identifier?.uri?.fsPath ?? null;
        info.set(header.composerId, {
            bucketId: identifier?.id ?? null,
            name: typeof header.name === 'string' ? header.name : null,
            uriPath: uriPath ? normalizeCursorPath(uriPath) : null,
        });
    }

    return info;
};

const collectBucketComposerIds = (buckets: CursorWorkspaceBucket[]): Map<string, string> => {
    const map = new Map<string, string>();
    for (const bucket of buckets) {
        for (const composerId of readBucketComposerIds(bucket.dbPath)) {
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

    if (stat.count > 0) {
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
        lastUpdatedAtMs: head?.lastUpdatedAtMs ?? null,
        mode: head?.mode ?? null,
        name: head?.name || headerInfo?.name || '(untitled)',
        stat,
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
    name: resolved.name,
    transcriptDirs: [],
    workspaceKey: resolved.groupKey,
    workspaceLabel: resolved.groupLabel,
});

const assembleDiscovery = (
    resolved: ResolvedThread[],
    bucketGroups: CursorWorkspaceGroup[],
    fileHistoryActivity: Map<string, number>,
): CursorDiscovery => {
    const threadsByKey = new Map<string, CursorThreadSummary[]>();
    const lastActiveByKey = new Map<string, number>();

    for (const thread of resolved) {
        // Empty threads with no resolvable workspace are pure noise; keep them out of the catch-all.
        if (thread.groupKey === UNKNOWN_GROUP_KEY && thread.stat.count === 0) {
            continue;
        }

        const list = threadsByKey.get(thread.groupKey) ?? [];
        list.push(toThreadSummary(thread));
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
    return { groups, threadsByKey };
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
        uri: folder ? `file://${folder}` : '',
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
    const buckets = await loadCursorBuckets(userDir);
    const bucketGroups = groupCursorBuckets(buckets);
    const globalDbPath = getCursorGlobalDbPath(userDir);

    if (!(await pathExists(globalDbPath))) {
        return assembleDiscovery([], bucketGroups, new Map());
    }

    const bucketIdToGroupKey = new Map<string, string>();
    const bucketIdToFolder = new Map<string, string | null>();
    for (const group of bucketGroups) {
        for (const bucket of group.buckets) {
            bucketIdToGroupKey.set(bucket.bucketId, group.key);
            bucketIdToFolder.set(bucket.bucketId, group.folders[0] ?? null);
        }
    }

    const db = openCursorReadonlyDb(globalDbPath);
    try {
        const heads = readAllHeads(db, options);
        if (options.updatedAfterMs !== undefined && heads.size === 0) {
            return assembleDiscovery([], bucketGroups, new Map());
        }

        const headerInfo = readHeaderInfo(globalDbPath);
        const bucketComposerIds = options.updatedAfterMs === undefined ? collectBucketComposerIds(buckets) : new Map();
        const stats = readBubbleStats(db, options.updatedAfterMs === undefined ? undefined : heads.keys());
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
                    stats.get(composerId) ?? { bytes: 0, count: 0 },
                    bucketIdToGroupKey,
                    bucketIdToFolder,
                    bucketComposerIds,
                    db,
                ),
            );
        }

        const fileHistoryActivity =
            options.updatedAfterMs === undefined ? await readCursorFileHistoryProjectActivity(userDir) : new Map();
        return assembleDiscovery(resolved, bucketGroups, fileHistoryActivity);
    } finally {
        db.close();
    }
};

const discoverCursorWorkspaces = async (
    userDir: string,
    options: CursorDiscoveryOptions = {},
): Promise<CursorDiscovery> => {
    if (options.updatedAfterMs !== undefined) {
        return await buildDiscovery(userDir, options);
    }

    const now = Date.now();
    if (discoveryCache && discoveryCache.userDir === userDir && now - discoveryCache.at < DISCOVERY_TTL_MS) {
        return discoveryCache.value;
    }

    const value = await buildDiscovery(userDir);
    discoveryCache = { at: now, userDir, value };
    return value;
};

export const readCursorThreadHead = (globalDbPath: string, composerId: string): CursorThreadHead | null => {
    const db = openCursorReadonlyDb(globalDbPath);
    try {
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
            name: asString(head.name ?? null),
            orderedBubbleIds,
            totalBubbleHeaders: headerList.length,
        };
    } finally {
        db.close();
    }
};

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

const findAgentTailStartIndex = (existingBubbles: CursorBubble[], agentBubbles: CursorBubble[]): number => {
    const maxOverlap = Math.min(existingBubbles.length, agentBubbles.length);
    // Agent transcript files contain the complete run while SQLite may lag or truncate the tail.
    // Match the longest SQLite suffix to the agent prefix, then append only the remaining agent tail.
    for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
        const existingStart = existingBubbles.length - overlapLength;
        const matches = agentBubbles
            .slice(0, overlapLength)
            .every((bubble, index) => areEquivalentBubbles(existingBubbles[existingStart + index]!, bubble));
        if (matches) {
            return overlapLength;
        }
    }

    return 0;
};

const hasEquivalentBubble = (bubbles: CursorBubble[], candidate: CursorBubble): boolean => {
    return bubbles.some((bubble) => areEquivalentBubbles(bubble, candidate));
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

const readCursorAgentTranscriptFile = async (filePath: string): Promise<CursorBubble[]> => {
    let text = '';
    try {
        text = await Bun.file(filePath).text();
    } catch (error) {
        warnCursorDataIssue('agent_transcript_unreadable', {
            error: error instanceof Error ? error.message : String(error),
            filePath,
        });
        return [];
    }

    const bubbles: CursorBubble[] = [];
    for (const [index, line] of text.split(/\n/u).entries()) {
        if (!line.trim()) {
            continue;
        }

        let raw: JsonValue;
        try {
            raw = JSON.parse(line) as JsonValue;
        } catch (error) {
            warnCursorDataIssue('invalid_agent_transcript_jsonl', {
                error: error instanceof Error ? error.message : String(error),
                filePath,
                lineNumber: index + 1,
            });
            continue;
        }

        const entry = asObject(raw);
        if (!entry) {
            continue;
        }

        const bubble = parseAgentTranscriptBubble(filePath, index + 1, entry);
        if (bubble) {
            bubbles.push(bubble);
        }
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

const readCursorAgentTranscriptBubbles = async (composerId: string, userDir: string): Promise<CursorBubble[]> => {
    const transcriptDirs = await findCursorTranscriptDirs(composerId, userDir);
    const bubbles: CursorBubble[] = [];
    for (const transcriptDir of transcriptDirs.sort()) {
        const files = await listCursorAgentTranscriptFiles(transcriptDir, composerId);
        for (const file of files) {
            bubbles.push(...(await readCursorAgentTranscriptFile(file)));
        }
    }

    return bubbles;
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
    const head = readCursorThreadHead(globalDbPath, composerId);
    if (!head) {
        return null;
    }

    const db = openCursorReadonlyDb(globalDbPath);
    try {
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
    } finally {
        db.close();
    }
};

export const readCursorThreadTranscriptWithAgentFiles = async (
    globalDbPath: string,
    composerId: string,
    userDir = inferCursorUserDirFromGlobalDbPath(globalDbPath),
): Promise<CursorThreadTranscript | null> => {
    const transcript = readCursorThreadTranscript(globalDbPath, composerId);
    if (!transcript) {
        return null;
    }

    const agentBubbles = await readCursorAgentTranscriptBubbles(composerId, userDir);
    return mergeAgentTranscriptTail(transcript, agentBubbles);
};

const readAllBubbleIds = (db: Database, composerId: string): string[] => {
    const prefix = `bubbleId:${composerId}:`;
    const rows = db.query('SELECT key FROM cursorDiskKV WHERE key LIKE ? ORDER BY key ASC').all(`${prefix}%`) as Array<{
        key: string;
    }>;
    return rows.map((row) => row.key.slice(prefix.length));
};
