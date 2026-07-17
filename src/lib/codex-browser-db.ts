import { constants, Database } from 'bun:sqlite';
import { closeSync, openSync, readdirSync, readSync, type Stats, statSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';
import type {
    DashboardSummary,
    DeleteProjectResult,
    DeleteThreadsResult,
    DynamicToolRow,
    ProjectSummary,
    ThreadBrowseData,
    ThreadListEntry,
} from './codex-browser-types';
import { getCachedParsedCodexTranscript, getThreadRolloutLoadState } from './codex-thread-cache';
import type { ThreadRelations, ThreadRow } from './codex-thread-types';
import { DEFAULT_CODEX_DIR, DEFAULT_DB_PATH } from './codex-thread-types';
import { mapWithConcurrency } from './concurrency';
import { getPortablePathBasename } from './portable-path';
import { cleanInlineTitle } from './shared';
import { runWithSqliteRetry } from './sqlite-retry';
import { invalidateCacheByPrefix } from './ui-cache';

type DeleteThreadOptions = {
    deleteSessionFiles?: boolean;
};

type DeleteProjectOptions = {
    deleteSessionFiles?: boolean;
};

const SQLITE_DELETE_BATCH_SIZE = 400;
const SESSION_FILE_DELETE_CONCURRENCY = 16;
const THREAD_LIST_IO_CONCURRENCY = 8;
const CODEX_READONLY_DB_OPEN_FLAGS = constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI;
const JSONL_READ_CHUNK_BYTES = 64 * 1024;
const SESSION_META_READ_LIMIT_BYTES = 4 * 1024 * 1024;
const FALLBACK_STATS_HEAD_READ_LIMIT_BYTES = 512 * 1024;
const FALLBACK_STATS_TAIL_READ_LIMIT_BYTES = 512 * 1024;
const FALLBACK_STATS_RECORD_PATTERN = /"type"\s*:\s*"(?:agent_message|message|token_count|turn_context)"/u;
const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu;
const sessionFileIndexCache = new Map<string, Map<string, string>>();
let sessionIndexMutationQueue = Promise.resolve();

type SessionIndexEntry = {
    id: string;
    thread_name?: string;
    updated_at?: string;
};

type FallbackSessionMeta = {
    agent_nickname?: string;
    agent_path?: string;
    agent_role?: string;
    cli_version?: string;
    cwd?: string;
    forked_from_id?: string;
    id?: string;
    model_provider?: string;
    parent_thread_id?: string;
    source?: unknown;
    thread_source?: string;
    timestamp?: string;
};

type ReadFallbackThreadRowsOptions = {
    includeSubagents?: boolean;
};

type FallbackRolloutStats = {
    model: string | null;
    tokensUsed: number;
};

type FallbackThreadRowOptions = ReadFallbackThreadRowsOptions & {
    projectName?: string | null;
};

const isSqliteCantOpenError = (error: unknown) => {
    return (error as { code?: unknown }).code === 'SQLITE_CANTOPEN';
};

const uniqueValues = <T>(values: T[]) => [...new Set(values)];

const chunkValues = <T>(values: T[], chunkSize: number) => {
    const chunks: T[][] = [];

    for (let index = 0; index < values.length; index += chunkSize) {
        chunks.push(values.slice(index, index + chunkSize));
    }

    return chunks;
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
        return false;
    }

    return 'then' in value && typeof value.then === 'function';
};

const openReadonlyDb = (dbPath: string) => {
    const db = new Database(dbPath, { readonly: true });
    try {
        db.query('SELECT name FROM sqlite_master LIMIT 1').get();
        return db;
    } catch (error) {
        db.close();
        if (!isSqliteCantOpenError(error)) {
            throw error;
        }
    }

    // Codex uses WAL mode; immutable URI reads keep Bun usable after clean shutdown removes sidecar files.
    return new Database(`${pathToFileURL(dbPath).href}?immutable=1`, CODEX_READONLY_DB_OPEN_FLAGS);
};

const openWritableDb = (dbPath: string, busyTimeoutMs: number) => {
    const db = new Database(dbPath);
    try {
        db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
        return db;
    } catch (error) {
        db.close();
        throw error;
    }
};

const toTimestampMs = (thread: ThreadRow) => {
    return thread.updated_at_ms ?? thread.updated_at * 1000;
};

const parseDynamicToolRow = (row: Record<string, number | string | null>): DynamicToolRow => {
    return {
        deferLoading: Number(row.defer_loading ?? 0) === 1,
        description: String(row.description ?? ''),
        inputSchema: parseJsonSafely(typeof row.input_schema === 'string' ? row.input_schema : null),
        name: String(row.name ?? 'unknown'),
        namespace: typeof row.namespace === 'string' ? row.namespace : null,
        position: Number(row.position ?? 0),
        threadId: String(row.thread_id),
    };
};

const parseJsonSafely = (value: string | null) => {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value) as DynamicToolRow['inputSchema'];
    } catch {
        return null;
    }
};

export const withReadonlyDb = <T>(dbPath: string, callback: (db: Database) => T): T => {
    return runWithSqliteRetry({
        action: () => {
            const db = openReadonlyDb(dbPath);
            try {
                const result = callback(db);
                if (isPromiseLike(result)) {
                    throw new Error('Database callbacks must be synchronous');
                }

                return result;
            } finally {
                db.close();
            }
        },
    });
};

const withWritableDb = <T>(dbPath: string, callback: (db: Database) => T): T => {
    const db = runWithSqliteRetry({
        action: () => {
            return openWritableDb(dbPath, 5000);
        },
    });
    try {
        const result = callback(db);
        if (isPromiseLike(result)) {
            throw new Error('Database callbacks must be synchronous');
        }

        return result;
    } finally {
        db.close();
    }
};

export const resolveCodexThreadDbPath = () => {
    const configuredDbPath = process.env.SPIRACHA_CODEX_DB?.trim();
    if (configuredDbPath) {
        return configuredDbPath;
    }

    const candidates = [
        DEFAULT_DB_PATH,
        path.join(DEFAULT_CODEX_DIR, 'sqlite', 'state_5.sqlite'),
        path.join(os.homedir(), '.codex', 'state_5.sqlite'),
    ];

    for (const candidate of candidates) {
        try {
            // Avoid opening candidates as a probe: Bun can make later read-only opens fail on Codex WAL databases.
            if (!statSync(candidate).isFile()) {
                continue;
            }
            return candidate;
        } catch {}
    }

    throw new Error(`Unable to open Codex thread database. Tried: ${candidates.join(', ')}`);
};

const readAllThreads = (dbPath: string): ThreadRow[] => {
    return withReadonlyDb(dbPath, (db) => {
        return db
            .query('SELECT * FROM threads ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC')
            .all() as ThreadRow[];
    });
};

const resolveCodexDirFromDbPath = (dbPath: string) => {
    const dbDir = path.dirname(dbPath);
    return path.basename(dbDir) === 'sqlite' ? path.dirname(dbDir) : dbDir;
};

const parseJsonlObject = <T>(line: string): T | null => {
    try {
        return JSON.parse(line) as T;
    } catch {
        return null;
    }
};

const emitJsonlLine = <T>(line: string, onRecord: (record: T) => void) => {
    const trimmed = line.trim();
    const parsed = trimmed ? parseJsonlObject<T>(trimmed) : null;
    if (parsed) {
        onRecord(parsed);
    }
};

const emitCompleteJsonlLines = <T>(text: string, onRecord: (record: T) => void): string => {
    const lines = text.split(/\r?\n/u);
    const pending = lines.pop() ?? '';
    for (const line of lines) {
        emitJsonlLine(line, onRecord);
    }
    return pending;
};

const readJsonlObjects = <T>(filePath: string, onRecord: (record: T) => void) => {
    let descriptor: number | null = null;
    try {
        const stats = statSync(filePath);
        if (!stats.isFile()) {
            return;
        }

        descriptor = openSync(filePath, 'r');
        const buffer = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        let position = 0;
        let pending = '';

        while (true) {
            const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
            if (bytesRead === 0) {
                break;
            }

            position += bytesRead;
            pending += decoder.write(buffer.subarray(0, bytesRead));
            pending = emitCompleteJsonlLines(pending, onRecord);
        }

        emitJsonlLine(pending + decoder.end(), onRecord);
    } catch {
        return;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
};

const collectJsonlObjects = <T>(filePath: string): T[] => {
    const records: T[] = [];
    readJsonlObjects<T>(filePath, (record) => {
        records.push(record);
    });
    return records;
};

const readSessionIndexEntries = (codexDir: string): SessionIndexEntry[] => {
    return collectJsonlObjects<SessionIndexEntry>(path.join(codexDir, 'session_index.jsonl')).filter(
        (entry) => typeof entry.id === 'string' && entry.id.length > 0,
    );
};

const collectSessionFilesByThreadId = (sessionsDir: string): Map<string, string> => {
    const sessionFiles = new Map<string, string>();
    const visit = (directory: string) => {
        const entries = (() => {
            try {
                return readdirSync(directory, { withFileTypes: true });
            } catch {
                return null;
            }
        })();
        if (!entries) {
            return;
        }

        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(entryPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            const threadId = THREAD_ID_PATTERN.exec(entry.name)?.[1];
            if (threadId && !sessionFiles.has(threadId)) {
                sessionFiles.set(threadId, entryPath);
            }
        }
    };

    visit(sessionsDir);
    return sessionFiles;
};

const findSessionFileByThreadId = (sessionsDir: string, threadId: string): string | null => {
    const lookup = (sessionFilesByThreadId: Map<string, string>) => {
        const sessionFile = sessionFilesByThreadId.get(threadId);
        if (!sessionFile) {
            return null;
        }

        try {
            return statSync(sessionFile).isFile() ? sessionFile : null;
        } catch {
            return null;
        }
    };

    const cached = sessionFileIndexCache.get(sessionsDir);
    const cachedMatch = cached ? lookup(cached) : null;
    if (cachedMatch) {
        return cachedMatch;
    }

    const refreshed = collectSessionFilesByThreadId(sessionsDir);
    sessionFileIndexCache.set(sessionsDir, refreshed);
    return lookup(refreshed);
};

const readSessionMetaLine = (sessionFile: string): string | null => {
    let descriptor: number | null = null;
    try {
        descriptor = openSync(sessionFile, 'r');
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        while (totalBytes < SESSION_META_READ_LIMIT_BYTES) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, SESSION_META_READ_LIMIT_BYTES - totalBytes));
            const bytesRead = readSync(descriptor, buffer, 0, buffer.length, totalBytes);
            if (bytesRead === 0) {
                break;
            }

            chunks.push(buffer.subarray(0, bytesRead));
            totalBytes += bytesRead;
            if (buffer.subarray(0, bytesRead).includes(10)) {
                break;
            }
        }

        const firstLine = Buffer.concat(chunks).toString('utf8').split(/\r?\n/u)[0]?.trim();
        return firstLine || null;
    } catch {
        return null;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
};

const readFallbackSessionMeta = (sessionFile: string): FallbackSessionMeta | null => {
    const line = readSessionMetaLine(sessionFile);
    if (!line) {
        return null;
    }

    try {
        const record = JSON.parse(line) as { payload?: FallbackSessionMeta; type?: string };
        return record.type === 'session_meta' && record.payload ? record.payload : null;
    } catch {
        return null;
    }
};

const parseIsoMs = (value: string | undefined, fallback: number) => {
    if (!value) {
        return fallback;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const stringOrNull = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const objectOrNull = (value: unknown) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
};

const isFallbackSubagent = (sessionMeta: FallbackSessionMeta) => {
    return Boolean(
        sessionMeta.thread_source === 'subagent' ||
            stringOrNull(sessionMeta.parent_thread_id) ||
            stringOrNull(sessionMeta.forked_from_id),
    );
};

const updateFallbackRolloutStatsFromRecord = (record: Record<string, unknown>, stats: FallbackRolloutStats): void => {
    const payload = objectOrNull(record.payload);
    if (!payload) {
        return;
    }

    if (record.type === 'turn_context') {
        stats.model = stringOrNull(payload.model) ?? stats.model;
        return;
    }

    const payloadType = stringOrNull(payload.type);
    if (payloadType === 'message' || payloadType === 'agent_message') {
        stats.model = stringOrNull(payload.model) ?? stats.model;
        return;
    }

    if (payloadType !== 'token_count') {
        return;
    }

    const info = objectOrNull(payload.info);
    const totalTokenUsage = objectOrNull(info?.total_token_usage);
    stats.tokensUsed = numberOrNull(totalTokenUsage?.total_tokens) ?? stats.tokensUsed;
};

const readFallbackStatsLine = (line: string, stats: FallbackRolloutStats) => {
    const trimmed = line.trim();
    if (!trimmed || !FALLBACK_STATS_RECORD_PATTERN.test(trimmed)) {
        return;
    }

    const record = parseJsonlObject<Record<string, unknown>>(trimmed);
    if (record) {
        updateFallbackRolloutStatsFromRecord(record, stats);
    }
};

const emitCompleteFallbackStatsLines = (text: string, stats: FallbackRolloutStats): string => {
    const lines = text.split(/\r?\n/u);
    const pending = lines.pop() ?? '';
    for (const line of lines) {
        readFallbackStatsLine(line, stats);
    }
    return pending;
};

const readFallbackRolloutStatsHead = (sessionFile: string, stats: FallbackRolloutStats, fileStats: Stats) => {
    let descriptor: number | null = null;
    try {
        if (!fileStats.isFile()) {
            return 0;
        }

        descriptor = openSync(sessionFile, 'r');
        const buffer = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        const readLimitBytes = Math.min(fileStats.size, FALLBACK_STATS_HEAD_READ_LIMIT_BYTES);
        let position = 0;
        let pending = '';

        while (position < readLimitBytes) {
            const bytesRead = readSync(
                descriptor,
                buffer,
                0,
                Math.min(buffer.length, readLimitBytes - position),
                position,
            );
            if (bytesRead === 0) {
                break;
            }

            position += bytesRead;
            pending += decoder.write(buffer.subarray(0, bytesRead));
            pending = emitCompleteFallbackStatsLines(pending, stats);
        }

        if (position >= fileStats.size) {
            readFallbackStatsLine(pending + decoder.end(), stats);
            return position;
        }

        decoder.end();
        return position;
    } catch {
        return 0;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
};

const trimPartialLeadingJsonlLine = (text: string) => {
    if (text.startsWith('\r\n')) {
        return text.slice(2);
    }

    if (text.startsWith('\n')) {
        return text.slice(1);
    }

    const match = /\r?\n/u.exec(text);
    return match ? text.slice(match.index + match[0].length) : '';
};

const readFallbackRolloutStatsTail = (
    sessionFile: string,
    stats: FallbackRolloutStats,
    fileStats: Stats,
    coveredPrefixBytes: number,
) => {
    let descriptor: number | null = null;
    try {
        if (!fileStats.isFile() || fileStats.size === 0) {
            return;
        }

        const suffixStart = Math.max(coveredPrefixBytes, fileStats.size - FALLBACK_STATS_TAIL_READ_LIMIT_BYTES);
        if (suffixStart >= fileStats.size) {
            return;
        }

        const readStart = suffixStart > 0 ? suffixStart - 1 : 0;
        const readLimitBytes = fileStats.size - readStart;
        descriptor = openSync(sessionFile, 'r');
        const buffer = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        let position = readStart;
        let remainingBytes = readLimitBytes;
        let text = '';

        while (remainingBytes > 0) {
            const bytesRead = readSync(descriptor, buffer, 0, Math.min(buffer.length, remainingBytes), position);
            if (bytesRead === 0) {
                break;
            }

            position += bytesRead;
            remainingBytes -= bytesRead;
            text += decoder.write(buffer.subarray(0, bytesRead));
        }

        text += decoder.end();
        const completeText = readStart > 0 ? trimPartialLeadingJsonlLine(text) : text;
        for (const line of completeText.split(/\r?\n/u)) {
            readFallbackStatsLine(line, stats);
        }
    } catch {
        return;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
};

const readFallbackRolloutStats = (sessionFile: string): FallbackRolloutStats => {
    const stats: FallbackRolloutStats = {
        model: null,
        tokensUsed: 0,
    };

    try {
        const fileStats = statSync(sessionFile);
        if (!fileStats.isFile()) {
            return stats;
        }

        const coveredPrefixBytes = readFallbackRolloutStatsHead(sessionFile, stats, fileStats);
        readFallbackRolloutStatsTail(sessionFile, stats, fileStats, coveredPrefixBytes);
    } catch {
        return stats;
    }

    return stats;
};

const buildFallbackThreadRow = (
    entry: SessionIndexEntry,
    sessionFile: string,
    sessionMeta: FallbackSessionMeta,
    rolloutStats: FallbackRolloutStats,
): ThreadRow | null => {
    const cwd = stringOrNull(sessionMeta.cwd);
    if (!cwd) {
        return null;
    }

    let mtimeMs = Date.now();
    try {
        mtimeMs = statSync(sessionFile).mtimeMs;
    } catch {}

    const updatedAtMs = parseIsoMs(entry.updated_at, mtimeMs);
    const createdAtMs = parseIsoMs(sessionMeta.timestamp, updatedAtMs);
    const title = entry.thread_name?.trim() || path.basename(sessionFile, '.jsonl');
    const source = stringOrNull(sessionMeta.source) ?? 'session_file';

    return {
        agent_nickname: sessionMeta.agent_nickname ?? null,
        agent_path: sessionMeta.agent_path ?? null,
        agent_role: sessionMeta.agent_role ?? null,
        approval_mode: 'unknown',
        archived: 0,
        archived_at: null,
        cli_version: sessionMeta.cli_version ?? '',
        created_at: Math.floor(createdAtMs / 1000),
        created_at_ms: Math.floor(createdAtMs),
        cwd,
        first_user_message: title,
        git_branch: null,
        git_origin_url: null,
        git_sha: null,
        has_user_event: sessionMeta.thread_source === 'user' ? 1 : 0,
        id: entry.id,
        memory_mode: 'enabled',
        model: rolloutStats.model,
        model_provider: sessionMeta.model_provider ?? 'unknown',
        preview: title,
        reasoning_effort: null,
        rollout_path: sessionFile,
        sandbox_policy: '{}',
        source,
        thread_source: sessionMeta.thread_source ?? null,
        title,
        tokens_used: rolloutStats.tokensUsed,
        updated_at: Math.floor(updatedAtMs / 1000),
        updated_at_ms: Math.floor(updatedAtMs),
    };
};

const readFallbackThreadRow = (
    entry: SessionIndexEntry,
    sessionFile: string,
    options: FallbackThreadRowOptions = {},
): ThreadRow | null => {
    const sessionMeta = readFallbackSessionMeta(sessionFile);
    if (!sessionMeta) {
        return null;
    }

    if (!options.includeSubagents && isFallbackSubagent(sessionMeta)) {
        return null;
    }

    const cwd = stringOrNull(sessionMeta.cwd);
    if (!cwd || (options.projectName && getPortablePathBasename(cwd) !== options.projectName)) {
        return null;
    }

    return buildFallbackThreadRow(entry, sessionFile, sessionMeta, readFallbackRolloutStats(sessionFile));
};

const readFallbackThreadRows = (
    dbPath: string,
    existingThreadIds: Set<string>,
    projectName: string | null = null,
    options: ReadFallbackThreadRowsOptions = {},
): ThreadRow[] => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const sessionFilesByThreadId = collectSessionFilesByThreadId(path.join(codexDir, 'sessions'));
    const fallbackThreads: ThreadRow[] = [];

    for (const entry of readSessionIndexEntries(codexDir)) {
        if (existingThreadIds.has(entry.id)) {
            continue;
        }

        const sessionFile = sessionFilesByThreadId.get(entry.id);
        if (!sessionFile) {
            continue;
        }

        const fallbackThread = readFallbackThreadRow(entry, sessionFile, {
            ...options,
            projectName,
        });
        if (!fallbackThread) {
            continue;
        }

        fallbackThreads.push(fallbackThread);
    }

    return fallbackThreads;
};

const readFallbackThreadRowById = (
    dbPath: string,
    threadId: string,
    options: ReadFallbackThreadRowsOptions = {},
): ThreadRow | null => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const entry = readSessionIndexEntries(codexDir).find((candidate) => candidate.id === threadId);
    if (!entry) {
        return null;
    }

    const sessionFile = findSessionFileByThreadId(path.join(codexDir, 'sessions'), threadId);
    if (!sessionFile) {
        return null;
    }

    return readFallbackThreadRow(entry, sessionFile, options);
};

const mergeFallbackThreadRows = (dbPath: string, threads: ThreadRow[], projectName: string | null = null) => {
    const threadIds = new Set(threads.map((thread) => thread.id));
    return [...threads, ...readFallbackThreadRows(dbPath, threadIds, projectName)].sort((left, right) => {
        const updatedDifference = toTimestampMs(right) - toTimestampMs(left);
        if (updatedDifference !== 0) {
            return updatedDifference;
        }

        return right.id.localeCompare(left.id);
    });
};

const applyRolloutActivityTimestamps = (threads: ThreadRow[]) => {
    return threads
        .map((thread) => {
            let rolloutUpdatedAtMs = toTimestampMs(thread);
            try {
                rolloutUpdatedAtMs = Math.max(rolloutUpdatedAtMs, statSync(thread.rollout_path).mtimeMs);
            } catch {}

            if (rolloutUpdatedAtMs <= toTimestampMs(thread)) {
                return thread;
            }

            return {
                ...thread,
                updated_at: Math.floor(rolloutUpdatedAtMs / 1000),
                updated_at_ms: Math.floor(rolloutUpdatedAtMs),
            };
        })
        .sort((left, right) => {
            const updatedDifference = toTimestampMs(right) - toTimestampMs(left);
            if (updatedDifference !== 0) {
                return updatedDifference;
            }

            return right.id.localeCompare(left.id);
        });
};

const buildDashboardRecentThreads = (threads: ThreadRow[]) => {
    const bestThreadByProject = new Map<string, ThreadRow>();
    for (const thread of threads) {
        const project = getPortablePathBasename(thread.cwd);
        if (!project) {
            continue;
        }

        const current = bestThreadByProject.get(project);
        if (!current || toTimestampMs(thread) > toTimestampMs(current)) {
            bestThreadByProject.set(project, thread);
        }
    }

    return [...bestThreadByProject.values()]
        .sort((left, right) => {
            const updatedDifference = toTimestampMs(right) - toTimestampMs(left);
            if (updatedDifference !== 0) {
                return updatedDifference;
            }

            return right.id.localeCompare(left.id);
        })
        .slice(0, 5)
        .map((thread) => ({
            project: getPortablePathBasename(thread.cwd),
            thread: compactThreadListRow(thread),
        }));
};

const filterThreadsByProject = (threads: ThreadRow[], projectName: string | null) => {
    if (!projectName) {
        return threads;
    }

    return threads.filter((thread) => getPortablePathBasename(thread.cwd) === projectName);
};

const buildProjectSummaryMap = (threads: ThreadRow[]) => {
    const projectMap = new Map<
        string,
        {
            archivedThreadCount: number;
            cwdPaths: Set<string>;
            lastUpdatedAtMs: number | null;
            modelNames: Set<string>;
            name: string;
            threadCount: number;
            totalTokens: number;
        }
    >();

    for (const thread of threads) {
        const projectName = getPortablePathBasename(thread.cwd);
        if (!projectName) {
            continue;
        }

        const current = projectMap.get(projectName) ?? {
            archivedThreadCount: 0,
            cwdPaths: new Set<string>(),
            lastUpdatedAtMs: null,
            modelNames: new Set<string>(),
            name: projectName,
            threadCount: 0,
            totalTokens: 0,
        };
        current.archivedThreadCount += thread.archived ? 1 : 0;
        current.cwdPaths.add(thread.cwd);
        current.lastUpdatedAtMs = Math.max(current.lastUpdatedAtMs ?? 0, toTimestampMs(thread));
        if (thread.model) {
            current.modelNames.add(thread.model);
        }
        current.threadCount += 1;
        current.totalTokens += thread.tokens_used;
        projectMap.set(projectName, current);
    }

    return projectMap;
};

const mapProjectSummaries = (projectMap: ReturnType<typeof buildProjectSummaryMap>): ProjectSummary[] => {
    return [...projectMap.values()]
        .map((project) => {
            return {
                archivedThreadCount: project.archivedThreadCount,
                cwdPaths: [...project.cwdPaths].sort(),
                lastUpdatedAtMs: project.lastUpdatedAtMs,
                modelNames: [...project.modelNames].sort(),
                name: project.name,
                threadCount: project.threadCount,
                totalTokens: project.totalTokens,
            };
        })
        .sort((left, right) => {
            if (left.totalTokens !== right.totalTokens) {
                return right.totalTokens - left.totalTokens;
            }

            return left.name.localeCompare(right.name);
        });
};

const getRelationsForThread = (db: Database, threadId: string, existingTableNames: Set<string>): ThreadRelations => {
    if (!existingTableNames.has('thread_spawn_edges')) {
        return {
            childEdges: [],
            parentThreadId: null,
        };
    }

    const parentRow = db
        .query(
            'SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges WHERE child_thread_id = ? LIMIT 1',
        )
        .get(threadId) as {
        child_thread_id: string;
        parent_thread_id: string;
        status: string;
    } | null;
    const childRows = db
        .query(
            'SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges WHERE parent_thread_id = ? ORDER BY child_thread_id ASC',
        )
        .all(threadId) as Array<{
        child_thread_id: string;
        parent_thread_id: string;
        status: string;
    }>;

    return {
        childEdges: childRows,
        parentThreadId: parentRow?.parent_thread_id ?? null,
    };
};

const getExistingTableNames = (db: Database) => {
    const rows = db.query('SELECT name FROM sqlite_master WHERE type = ?').all('table') as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
};

const getThreadDeleteTargets = (db: Database, threadIds: string[]) => {
    if (threadIds.length === 0) {
        return [];
    }

    const targets: Array<{ id: string; rollout_path: string }> = [];

    for (const threadIdChunk of chunkValues(threadIds, SQLITE_DELETE_BATCH_SIZE)) {
        const placeholders = threadIdChunk.map(() => '?').join(', ');
        targets.push(
            ...(db
                .query(`SELECT id, rollout_path FROM threads WHERE id IN (${placeholders})`)
                .all(...threadIdChunk) as Array<{
                id: string;
                rollout_path: string;
            }>),
        );
    }

    return targets;
};

const deleteThreadIds = (db: Database, threadIds: string[]): DeleteThreadsResult => {
    if (threadIds.length === 0) {
        return {
            deletedSessionFiles: [],
            deletedThreadIds: [],
        };
    }

    const existingTableNames = getExistingTableNames(db);
    const threadTargets = getThreadDeleteTargets(db, threadIds);
    const existingIds = threadTargets.map((target) => target.id);

    if (existingIds.length === 0) {
        return {
            deletedSessionFiles: [],
            deletedThreadIds: [],
        };
    }

    const deleteMany = db.transaction((ids: string[]) => {
        for (const threadIdChunk of chunkValues(ids, SQLITE_DELETE_BATCH_SIZE)) {
            const placeholders = threadIdChunk.map(() => '?').join(', ');

            // Codex schema differs across versions, so only touch dependent tables that actually exist.
            if (existingTableNames.has('thread_dynamic_tools')) {
                db.query(`DELETE FROM thread_dynamic_tools WHERE thread_id IN (${placeholders})`).run(...threadIdChunk);
            }

            if (existingTableNames.has('thread_goals')) {
                db.query(`DELETE FROM thread_goals WHERE thread_id IN (${placeholders})`).run(...threadIdChunk);
            }

            if (existingTableNames.has('stage1_outputs')) {
                db.query(`DELETE FROM stage1_outputs WHERE thread_id IN (${placeholders})`).run(...threadIdChunk);
            }

            if (existingTableNames.has('thread_spawn_edges')) {
                db.query(
                    `DELETE FROM thread_spawn_edges WHERE parent_thread_id IN (${placeholders}) OR child_thread_id IN (${placeholders})`,
                ).run(...threadIdChunk, ...threadIdChunk);
            }

            db.query(`DELETE FROM threads WHERE id IN (${placeholders})`).run(...threadIdChunk);
        }
    });

    deleteMany(existingIds);

    return {
        deletedSessionFiles: threadTargets.map((target) => target.rollout_path),
        deletedThreadIds: existingIds,
    };
};

const deleteThreadSessionFiles = async (sessionFiles: string[]) => {
    const uniqueSessionFiles = [...new Set(sessionFiles)];
    await mapWithConcurrency(uniqueSessionFiles, SESSION_FILE_DELETE_CONCURRENCY, async (sessionFile) => {
        await rm(sessionFile, { force: true });
        return sessionFile;
    });
    return uniqueSessionFiles;
};

const getSessionFilesForThreadIds = (dbPath: string, threadIds: string[]) => {
    if (threadIds.length === 0) {
        return [];
    }

    const codexDir = resolveCodexDirFromDbPath(dbPath);
    if (threadIds.length === 1) {
        const sessionFile = findSessionFileByThreadId(path.join(codexDir, 'sessions'), threadIds[0]!);
        return sessionFile ? [sessionFile] : [];
    }

    const sessionFilesByThreadId = collectSessionFilesByThreadId(path.join(codexDir, 'sessions'));
    return threadIds
        .map((threadId) => sessionFilesByThreadId.get(threadId))
        .filter((value): value is string => Boolean(value));
};

const filterSessionIndexLines = (lines: string[], threadIds: Set<string>) => {
    const removedThreadIds: string[] = [];
    const retainedLines: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        const entry = parseJsonlObject<SessionIndexEntry>(trimmed);
        if (entry?.id && threadIds.has(entry.id)) {
            removedThreadIds.push(entry.id);
            continue;
        }

        retainedLines.push(trimmed);
    }

    return { removedThreadIds, retainedLines };
};

const writeSessionIndexLines = async (sessionIndexPath: string, codexDir: string, retainedLines: string[]) => {
    const tempSessionIndexPath = path.join(
        codexDir,
        `.session_index.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
        await Bun.write(tempSessionIndexPath, retainedLines.length > 0 ? `${retainedLines.join('\n')}\n` : '');
        await rename(tempSessionIndexPath, sessionIndexPath);
    } catch (error) {
        await rm(tempSessionIndexPath, { force: true });
        throw error;
    }
};

const removeSessionIndexEntries = async (codexDir: string, threadIds: string[]) => {
    const runMutation = async () => {
        const uniqueThreadIds = new Set(threadIds);
        if (uniqueThreadIds.size === 0) {
            return [];
        }

        const sessionIndexPath = path.join(codexDir, 'session_index.jsonl');
        if (!(await Bun.file(sessionIndexPath).exists())) {
            return [];
        }

        const lines = (await Bun.file(sessionIndexPath).text()).split(/\r?\n/u);
        const { removedThreadIds, retainedLines } = filterSessionIndexLines(lines, uniqueThreadIds);

        if (removedThreadIds.length === 0) {
            return [];
        }

        await writeSessionIndexLines(sessionIndexPath, codexDir, retainedLines);
        return uniqueValues(removedThreadIds);
    };

    const mutation = sessionIndexMutationQueue.then(runMutation, runMutation);
    sessionIndexMutationQueue = mutation.then(
        () => undefined,
        () => undefined,
    );
    return mutation;
};

const listFallbackThreadIdsForProject = (dbPath: string, existingThreadIds: Set<string>, projectName: string) => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const sessionFilesByThreadId = collectSessionFilesByThreadId(path.join(codexDir, 'sessions'));
    const fallbackThreadIds: string[] = [];

    for (const entry of readSessionIndexEntries(codexDir)) {
        if (existingThreadIds.has(entry.id) || !sessionFilesByThreadId.has(entry.id)) {
            continue;
        }

        const sessionMeta = readFallbackSessionMeta(sessionFilesByThreadId.get(entry.id)!);
        if (!sessionMeta || isFallbackSubagent(sessionMeta)) {
            continue;
        }

        const cwd = stringOrNull(sessionMeta.cwd);
        if (cwd && getPortablePathBasename(cwd) === projectName) {
            fallbackThreadIds.push(entry.id);
        }
    }

    return fallbackThreadIds;
};

const deleteSessionIndexEntriesForThreads = async (
    dbPath: string,
    threadIds: string[],
    dbDeletedSessionFiles: string[],
    deleteSessionFiles: boolean,
) => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const removedThreadIds = await removeSessionIndexEntries(codexDir, threadIds);
    const fallbackSessionFiles = deleteSessionFiles ? getSessionFilesForThreadIds(dbPath, removedThreadIds) : [];

    return {
        deletedSessionFiles: deleteSessionFiles
            ? await deleteThreadSessionFiles([...dbDeletedSessionFiles, ...fallbackSessionFiles])
            : [],
        deletedThreadIds: removedThreadIds,
    };
};

export const listCodexProjects = (dbPath: string): ProjectSummary[] => {
    return mapProjectSummaries(
        buildProjectSummaryMap(applyRolloutActivityTimestamps(mergeFallbackThreadRows(dbPath, readAllThreads(dbPath)))),
    );
};

type ListProjectThreadsOptions = {
    includeTranscriptStats?: boolean;
    largeTranscriptThresholdBytes?: number;
};

const compactThreadListRow = (thread: ThreadRow): ThreadRow => {
    return {
        ...thread,
        preview: cleanInlineTitle(thread.preview || thread.first_user_message || ''),
        title: cleanInlineTitle(thread.title),
    };
};

export const listProjectThreads = async (
    dbPath: string,
    projectName: string,
    options: ListProjectThreadsOptions = {},
): Promise<ThreadListEntry[]> => {
    const threads = mergeFallbackThreadRows(
        dbPath,
        filterThreadsByProject(readAllThreads(dbPath), projectName),
        projectName,
    );
    const activeThreads = applyRolloutActivityTimestamps(threads);
    const entries = await mapWithConcurrency(activeThreads, THREAD_LIST_IO_CONCURRENCY, async (thread) => {
        const rollout = await getThreadRolloutLoadState(thread.rollout_path, options.largeTranscriptThresholdBytes);

        if (rollout.fileSizeBytes === null) {
            return {
                project: projectName,
                rolloutSizeBytes: null,
                stats: {
                    deferred: false,
                    execCommandCount: 0,
                    toolCallCount: 0,
                    webSearchEventCount: 0,
                },
                thread: compactThreadListRow(thread),
            };
        }

        if (rollout.shouldDeferTranscriptLoad || options.includeTranscriptStats === false) {
            return {
                project: projectName,
                rolloutSizeBytes: rollout.fileSizeBytes,
                stats: {
                    deferred: true,
                    execCommandCount: 0,
                    toolCallCount: 0,
                    webSearchEventCount: 0,
                },
                thread: compactThreadListRow(thread),
            };
        }

        const transcript = await getCachedParsedCodexTranscript(thread.rollout_path);

        return {
            project: projectName,
            rolloutSizeBytes: rollout.fileSizeBytes,
            stats: {
                deferred: false,
                execCommandCount: transcript.stats.execCommandCount,
                toolCallCount: transcript.stats.toolCallCount,
                webSearchEventCount: transcript.stats.webSearchEventCount,
            },
            thread: compactThreadListRow(thread),
        };
    });

    return entries.sort((left, right) => toTimestampMs(right.thread) - toTimestampMs(left.thread));
};

export const getThreadBrowseData = (dbPath: string, threadId: string): ThreadBrowseData => {
    return withReadonlyDb(dbPath, (db) => {
        const existingTableNames = getExistingTableNames(db);
        const dbThread = db.query('SELECT * FROM threads WHERE id = ? LIMIT 1').get(threadId) as ThreadRow | null;
        const thread = dbThread ?? readFallbackThreadRowById(dbPath, threadId, { includeSubagents: true }) ?? null;
        if (!thread) {
            throw new Error(`Thread not found: ${threadId}`);
        }

        const dynamicTools =
            dbThread && existingTableNames.has('thread_dynamic_tools')
                ? (db
                      .query(
                          'SELECT thread_id, position, name, description, input_schema, defer_loading, namespace FROM thread_dynamic_tools WHERE thread_id = ? ORDER BY position ASC',
                      )
                      .all(threadId) as Array<Record<string, number | string | null>>)
                : [];

        return {
            dynamicTools: dynamicTools.map((row) => parseDynamicToolRow(row)),
            project: getPortablePathBasename(thread.cwd),
            relations: getRelationsForThread(db, threadId, existingTableNames),
            thread,
        };
    });
};

export const getCodexDashboardSummary = (dbPath: string): DashboardSummary => {
    const threads = applyRolloutActivityTimestamps(mergeFallbackThreadRows(dbPath, readAllThreads(dbPath)));
    const projects = mapProjectSummaries(buildProjectSummaryMap(threads));
    const threadsWithRelations = withReadonlyDb(dbPath, (db) => {
        if (!getExistingTableNames(db).has('thread_spawn_edges')) {
            return 0;
        }

        const rows = db.query('SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges').all() as Array<{
            child_thread_id: string;
            parent_thread_id: string;
        }>;
        const relatedThreadIds = new Set(rows.flatMap((row) => [row.parent_thread_id, row.child_thread_id]));
        return relatedThreadIds.size;
    });

    return {
        activeThreads: threads.filter((thread) => !thread.archived).length,
        archivedThreads: threads.filter((thread) => Boolean(thread.archived)).length,
        recentThreads: buildDashboardRecentThreads(threads),
        threadsWithRelations,
        topProjectsByThreadCount: [...projects]
            .sort((left, right) => {
                if (left.threadCount !== right.threadCount) {
                    return right.threadCount - left.threadCount;
                }

                return left.name.localeCompare(right.name);
            })
            .slice(0, 5),
        topProjectsByTokens: projects.slice(0, 5),
        totalProjects: projects.length,
        totalThreads: threads.length,
        totalTokens: threads.reduce((sum, thread) => sum + thread.tokens_used, 0),
    };
};

export const deleteCodexThread = async (
    dbPath: string,
    threadId: string,
    options: DeleteThreadOptions = {},
): Promise<DeleteThreadsResult> => {
    const threadIds = [threadId];
    const result = withWritableDb(dbPath, (db) => {
        return deleteThreadIds(db, threadIds);
    });

    try {
        const sessionIndexResult = await deleteSessionIndexEntriesForThreads(
            dbPath,
            threadIds,
            result.deletedSessionFiles,
            Boolean(options.deleteSessionFiles),
        );

        return {
            deletedSessionFiles: sessionIndexResult.deletedSessionFiles,
            deletedThreadIds: uniqueValues([...result.deletedThreadIds, ...sessionIndexResult.deletedThreadIds]),
        };
    } finally {
        await invalidateCodexUiCaches();
    }
};

export const deleteCodexThreads = async (
    dbPath: string,
    threadIds: string[],
    options: DeleteThreadOptions = {},
): Promise<DeleteThreadsResult> => {
    const uniqueThreadIds = uniqueValues(threadIds);
    const result = withWritableDb(dbPath, (db) => {
        return deleteThreadIds(db, uniqueThreadIds);
    });

    try {
        const sessionIndexResult = await deleteSessionIndexEntriesForThreads(
            dbPath,
            uniqueThreadIds,
            result.deletedSessionFiles,
            Boolean(options.deleteSessionFiles),
        );

        return {
            deletedSessionFiles: sessionIndexResult.deletedSessionFiles,
            deletedThreadIds: uniqueValues([...result.deletedThreadIds, ...sessionIndexResult.deletedThreadIds]),
        };
    } finally {
        await invalidateCodexUiCaches();
    }
};

export const deleteCodexProject = async (
    dbPath: string,
    projectName: string,
    options: DeleteProjectOptions = {},
): Promise<DeleteProjectResult> => {
    const existingThreadIds = new Set(readAllThreads(dbPath).map((thread) => thread.id));
    const fallbackThreadIds = listFallbackThreadIdsForProject(dbPath, existingThreadIds, projectName);
    const result = withWritableDb(dbPath, (db) => {
        const threads = db.query('SELECT id, cwd FROM threads').all() as Array<{ cwd: string; id: string }>;
        const threadIds = threads
            .filter((thread) => getPortablePathBasename(thread.cwd) === projectName)
            .map((thread) => thread.id);
        const deleted = deleteThreadIds(db, threadIds);

        return {
            ...deleted,
            projectName,
        };
    });

    try {
        const sessionIndexResult = await deleteSessionIndexEntriesForThreads(
            dbPath,
            [...result.deletedThreadIds, ...fallbackThreadIds],
            result.deletedSessionFiles,
            Boolean(options.deleteSessionFiles),
        );

        return {
            ...result,
            deletedSessionFiles: sessionIndexResult.deletedSessionFiles,
            deletedThreadIds: uniqueValues([...result.deletedThreadIds, ...sessionIndexResult.deletedThreadIds]),
        };
    } finally {
        await invalidateCodexUiCaches();
    }
};

export const listScopedThreads = (dbPath: string, projectName: string | null): ThreadRow[] => {
    return mergeFallbackThreadRows(dbPath, filterThreadsByProject(readAllThreads(dbPath), projectName), projectName);
};

export const invalidateCodexUiCaches = async () => {
    await invalidateCacheByPrefix('analytics-', 'thread-', 'thread-preview-');
};
