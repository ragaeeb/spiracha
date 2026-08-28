import { constants, Database } from 'bun:sqlite';
import { closeSync, openSync, readdirSync, readSync, type Stats, statSync } from 'node:fs';
import { realpath, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';
import type {
    CodexDbSchemaProfile,
    CodexSessionIndexReconciliation,
    CodexThreadBrowseBatchResult,
    DashboardSummary,
    DashboardThreadSummary,
    DeleteProjectResult,
    DeleteThreadsResult,
    DynamicToolRow,
    ProjectSummary,
    ThreadBrowseData,
    ThreadListEntry,
} from './codex-browser-types';
import { removeCodexGlobalStateThreadReferencesFromFile } from './codex-global-state';
import {
    getCachedCodexTranscriptModelNames,
    getCachedCodexTranscriptStats,
    getThreadRolloutLoadState,
} from './codex-thread-cache';
import type { SpawnEdgeRow, ThreadRelations, ThreadRow } from './codex-thread-types';
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
// Let the bounded retry policy own lock waiting so a failed transaction is retried on a fresh connection.
const SQLITE_BUSY_TIMEOUT_MS = 0;
const SESSION_FILE_DELETE_CONCURRENCY = 16;
const THREAD_LIST_IO_CONCURRENCY = 8;
const DASHBOARD_RESULT_LIMIT = 5;
const CODEX_READONLY_DB_OPEN_FLAGS = constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI;
const JSONL_READ_CHUNK_BYTES = 64 * 1024;
const SESSION_META_READ_CHUNK_BYTES = 64 * 1024;
const SESSION_META_READ_LIMIT_BYTES = 4 * 1024 * 1024;
const FALLBACK_STATS_HEAD_READ_LIMIT_BYTES = 512 * 1024;
const FALLBACK_STATS_TAIL_READ_LIMIT_BYTES = 512 * 1024;
const FALLBACK_STATS_RECORD_PATTERN = /"type"\s*:\s*"(?:agent_message|message|token_count|turn_context)"/u;
const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu;
const CODEX_UI_CACHE_PREFIXES = ['analytics-', 'thread-', 'thread-preview-'] as const;
const THREAD_ROW_COLUMNS = `
    id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
    sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
    git_sha, git_branch, git_origin_url, cli_version, first_user_message, agent_nickname,
    agent_role, memory_mode, model, reasoning_effort, agent_path, created_at_ms,
    updated_at_ms, thread_source, preview
`;
const REQUIRED_BROWSE_THREAD_COLUMNS = [
    'id',
    'rollout_path',
    'created_at',
    'updated_at',
    'source',
    'model_provider',
    'cwd',
    'title',
    'sandbox_policy',
    'approval_mode',
    'tokens_used',
    'has_user_event',
    'archived',
    'archived_at',
    'git_sha',
    'git_branch',
    'git_origin_url',
    'cli_version',
    'first_user_message',
    'agent_nickname',
    'agent_role',
    'memory_mode',
    'model',
    'reasoning_effort',
    'agent_path',
    'created_at_ms',
    'updated_at_ms',
    'thread_source',
    'preview',
] as const;
const CODEX_BROWSE_SCHEMA_PROFILE: CodexDbSchemaProfile = {
    name: 'codex-state-5-thread-browse-v1',
    requiredColumns: {
        thread_dynamic_tools: [
            'thread_id',
            'position',
            'name',
            'description',
            'input_schema',
            'defer_loading',
            'namespace',
        ],
        thread_goals: [
            'thread_id',
            'goal_id',
            'objective',
            'status',
            'token_budget',
            'tokens_used',
            'time_used_seconds',
            'created_at_ms',
            'updated_at_ms',
        ],
        thread_spawn_edges: ['parent_thread_id', 'child_thread_id', 'status'],
        threads: REQUIRED_BROWSE_THREAD_COLUMNS,
    },
    requiredTables: ['threads'],
};
const PROJECT_CWD_FILTER = `
    typeof(cwd) = 'text'
    AND (
        RTRIM(cwd, '/\\') = ?1
        OR SUBSTR(RTRIM(cwd, '/\\'), -(LENGTH(?1) + 1)) = '/' || ?1
        OR SUBSTR(RTRIM(cwd, '/\\'), -(LENGTH(?1) + 1)) = '\\' || ?1
    )
`;

type ActivityTimestampedThread = {
    id: string;
    rollout_path: string;
    updated_at: number;
    updated_at_ms: number | null;
};

type DashboardThreadCandidate = DashboardThreadSummary & Pick<ThreadRow, 'first_user_message' | 'rollout_path'>;

type ProjectAggregateRow = {
    archived_thread_count: number;
    cwd: string;
    last_updated_at_ms: number | null;
    model: string | null;
    thread_count: number;
    total_tokens: number;
};

type ThreadGoalRow = {
    created_at_ms: number;
    goal_id: string;
    objective: string;
    status: string;
    time_used_seconds: number;
    token_budget: number | null;
    tokens_used: number;
    updated_at_ms: number;
};

type ProjectSummaryAccumulator = {
    archivedThreadCount: number;
    cwdPaths: Set<string>;
    lastUpdatedAtMs: number | null;
    modelNames: Set<string>;
    name: string;
    threadCount: number;
    totalTokens: number;
};

type ProjectSummaryMap = Map<string, ProjectSummaryAccumulator>;
type SessionFileIndexCacheEntry = {
    fingerprint: string;
    sessionFilesByThreadId: Map<string, string>;
};

type FallbackThreadRowCacheEntry = {
    fingerprint: string;
    row: ThreadRow | null;
    sessionMeta: FallbackSessionMeta | null;
};

const sessionFileIndexCache = new Map<string, SessionFileIndexCacheEntry>();
const sessionIndexEntriesCache = new Map<string, { entries: SessionIndexEntry[]; fingerprint: string }>();
const fallbackThreadRowCache = new Map<string, FallbackThreadRowCacheEntry>();
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
    dynamic_tools?: unknown;
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

type DeleteThreadMutationResult = {
    deletedRolloutPaths: string[];
    deletedThreadIds: string[];
};

const isSqliteCantOpenError = (error: unknown) => {
    return (error as { code?: unknown }).code === 'SQLITE_CANTOPEN';
};

const uniqueValues = <T>(values: T[]) => [...new Set(values)];

const compareCodeUnits = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

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
    const db = new Database(dbPath, { create: false, readwrite: true });
    try {
        db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
        return db;
    } catch (error) {
        db.close();
        throw error;
    }
};

const getThreadUpdatedAtMs = (thread: Pick<ThreadRow, 'updated_at' | 'updated_at_ms'>) => {
    return thread.updated_at_ms ?? thread.updated_at * 1000;
};

const compareThreadsByRecentActivity = (
    left: Pick<ThreadRow, 'id' | 'updated_at' | 'updated_at_ms'>,
    right: Pick<ThreadRow, 'id' | 'updated_at' | 'updated_at_ms'>,
) => getThreadUpdatedAtMs(right) - getThreadUpdatedAtMs(left) || compareCodeUnits(right.id, left.id);

type CodexRowDecoder = {
    assertValid: () => void;
    nullableNumber: (field: string) => number | null;
    requiredNumber: (field: string) => number;
    requiredString: (field: string) => string;
    values: Record<string, unknown>;
};

const createCodexRowDecoder = (row: unknown, tableName: string): CodexRowDecoder => {
    const values = row as Record<string, unknown>;
    const invalidFields: string[] = [];
    const fieldPath = (field: string) => `${tableName}.${field}`;
    const requiredString = (field: string) => {
        const value = values[field];
        if (typeof value !== 'string') {
            invalidFields.push(fieldPath(field));
            return '';
        }
        return value;
    };
    const requiredNumber = (field: string) => {
        const value = values[field];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            invalidFields.push(fieldPath(field));
            return 0;
        }
        return value;
    };
    const nullableNumber = (field: string) => {
        const value = values[field];
        if (value === null) {
            return null;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            invalidFields.push(fieldPath(field));
            return null;
        }
        return value;
    };

    return {
        assertValid: () => {
            if (invalidFields.length > 0) {
                throw new CodexDbCompatibilityError(CODEX_BROWSE_SCHEMA_PROFILE, [], [], invalidFields);
            }
        },
        nullableNumber,
        requiredNumber,
        requiredString,
        values,
    };
};

const parseDynamicToolRow = (row: unknown): DynamicToolRow => {
    const decoder = createCodexRowDecoder(row, 'thread_dynamic_tools');
    const decoded = {
        deferLoading: Number(decoder.values.defer_loading ?? 0) === 1,
        description: decoder.requiredString('description'),
        inputSchema: parseJsonSafely(
            typeof decoder.values.input_schema === 'string' ? decoder.values.input_schema : null,
        ),
        name: decoder.requiredString('name'),
        namespace: typeof decoder.values.namespace === 'string' ? decoder.values.namespace : null,
        position: decoder.requiredNumber('position'),
        threadId: decoder.requiredString('thread_id'),
    };
    decoder.assertValid();
    return decoded;
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

const decodeThreadGoalRow = (row: unknown): ThreadGoalRow => {
    const decoder = createCodexRowDecoder(row, 'thread_goals');
    const decoded = {
        created_at_ms: decoder.requiredNumber('created_at_ms'),
        goal_id: decoder.requiredString('goal_id'),
        objective: decoder.requiredString('objective'),
        status: decoder.requiredString('status'),
        time_used_seconds: decoder.requiredNumber('time_used_seconds'),
        token_budget: decoder.nullableNumber('token_budget'),
        tokens_used: decoder.requiredNumber('tokens_used'),
        updated_at_ms: decoder.requiredNumber('updated_at_ms'),
    };
    decoder.assertValid();
    return decoded;
};

const decodeThreadSpawnEdgeRow = (row: unknown): ThreadSpawnEdge => {
    const decoder = createCodexRowDecoder(row, 'thread_spawn_edges');
    const decoded = {
        child_thread_id: decoder.requiredString('child_thread_id'),
        parent_thread_id: decoder.requiredString('parent_thread_id'),
        status: decoder.requiredString('status'),
    };
    decoder.assertValid();
    return decoded;
};

export class CodexDbCompatibilityError extends Error {
    readonly code = 'CODEX_DB_INCOMPATIBLE';
    readonly invalidFields: string[];
    readonly missingColumns: string[];
    readonly missingTables: string[];
    readonly profileName: string;

    constructor(
        profile: CodexDbSchemaProfile,
        missingTables: string[],
        missingColumns: string[],
        invalidFields: string[] = [],
    ) {
        const details = [
            missingTables.length > 0 ? `missing tables: ${missingTables.join(', ')}` : '',
            missingColumns.length > 0 ? `missing columns: ${missingColumns.join(', ')}` : '',
            invalidFields.length > 0 ? `invalid fields: ${invalidFields.join(', ')}` : '',
        ].filter(Boolean);
        super(`Unsupported Codex database schema for ${profile.name}; ${details.join('; ')}`);
        this.name = 'CodexDbCompatibilityError';
        this.missingColumns = missingColumns;
        this.missingTables = missingTables;
        this.profileName = profile.name;
        this.invalidFields = invalidFields;
    }
}

const CODEX_SCHEMA_TABLE_PRAGMAS: Record<string, string> = {
    thread_dynamic_tools: 'PRAGMA table_info(thread_dynamic_tools)',
    thread_goals: 'PRAGMA table_info(thread_goals)',
    thread_spawn_edges: 'PRAGMA table_info(thread_spawn_edges)',
    threads: 'PRAGMA table_info(threads)',
};

const getSchemaTableColumns = (db: Database, tableName: string) => {
    if (!Object.hasOwn(CODEX_SCHEMA_TABLE_PRAGMAS, tableName)) {
        throw new Error(`Unsupported Codex schema table: ${tableName}`);
    }
    const pragma = CODEX_SCHEMA_TABLE_PRAGMAS[tableName]!;

    return new Set((db.query(pragma).all() as Array<{ name: string }>).map((column) => column.name));
};

const assertCodexSchemaCompatibility = (db: Database, profile: CodexDbSchemaProfile) => {
    const tableNames = new Set(
        (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
            (table) => table.name,
        ),
    );
    const missingTables = profile.requiredTables.filter((tableName) => !tableNames.has(tableName));
    const missingColumns: string[] = [];

    for (const [tableName, requiredColumns] of Object.entries(profile.requiredColumns)) {
        if (!tableNames.has(tableName)) {
            continue;
        }

        const actualColumns = getSchemaTableColumns(db, tableName);
        for (const columnName of requiredColumns) {
            if (!actualColumns.has(columnName)) {
                missingColumns.push(`${tableName}.${columnName}`);
            }
        }
    }

    if (missingTables.length > 0 || missingColumns.length > 0) {
        throw new CodexDbCompatibilityError(profile, missingTables, missingColumns);
    }

    return tableNames;
};

const decodeThreadRow = (row: unknown): ThreadRow => {
    const values = row as Record<string, unknown>;
    const invalidFields: string[] = [];
    const requiredString = (field: keyof ThreadRow) => {
        const value = values[field];
        if (typeof value !== 'string') {
            invalidFields.push(`threads.${String(field)}`);
            return '';
        }
        return value;
    };
    const requiredNumber = (field: keyof ThreadRow) => {
        const value = values[field];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            invalidFields.push(`threads.${String(field)}`);
            return 0;
        }
        return value;
    };
    const nullableString = (field: keyof ThreadRow) => {
        const value = values[field];
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value !== 'string') {
            invalidFields.push(`threads.${String(field)}`);
            return null;
        }
        return value;
    };
    const nullableNumber = (field: keyof ThreadRow) => {
        const value = values[field];
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            invalidFields.push(`threads.${String(field)}`);
            return null;
        }
        return value;
    };

    const decoded: ThreadRow = {
        agent_nickname: nullableString('agent_nickname'),
        agent_path: nullableString('agent_path'),
        agent_role: nullableString('agent_role'),
        approval_mode: requiredString('approval_mode'),
        archived: requiredNumber('archived'),
        archived_at: nullableNumber('archived_at'),
        cli_version: requiredString('cli_version'),
        created_at: requiredNumber('created_at'),
        created_at_ms: nullableNumber('created_at_ms'),
        cwd: requiredString('cwd'),
        first_user_message: requiredString('first_user_message'),
        git_branch: nullableString('git_branch'),
        git_origin_url: nullableString('git_origin_url'),
        git_sha: nullableString('git_sha'),
        has_user_event: requiredNumber('has_user_event'),
        id: requiredString('id'),
        memory_mode: requiredString('memory_mode'),
        model: nullableString('model'),
        model_provider: requiredString('model_provider'),
        preview: requiredString('preview'),
        reasoning_effort: nullableString('reasoning_effort'),
        rollout_path: requiredString('rollout_path'),
        sandbox_policy: requiredString('sandbox_policy'),
        source: requiredString('source'),
        thread_source: nullableString('thread_source'),
        title: requiredString('title'),
        tokens_used: requiredNumber('tokens_used'),
        updated_at: requiredNumber('updated_at'),
        updated_at_ms: nullableNumber('updated_at_ms'),
    };
    if (invalidFields.length > 0) {
        throw new CodexDbCompatibilityError(CODEX_BROWSE_SCHEMA_PROFILE, [], [], invalidFields);
    }
    return decoded;
};

const withSqliteTransaction = <T>(db: Database, callback: (db: Database) => T): T => {
    db.exec('BEGIN DEFERRED');
    try {
        const result = callback(db);
        db.exec('COMMIT');
        return result;
    } catch (error) {
        if (db.inTransaction) {
            try {
                db.exec('ROLLBACK');
            } catch (rollbackError) {
                console.warn('[spiracha:codex] SQLite rollback failed', {
                    error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
                });
            }
        }
        throw error;
    }
};

const getUserVisibleThreadFilter = (db: Database) => {
    const threadColumns = db.query('PRAGMA table_info(threads)').all() as Array<{ name: string }>;
    if (!threadColumns.some((column) => column.name === 'thread_source')) {
        return '1';
    }

    // Codex stores internal guardian evaluations as subagent rows without user-facing chat entries.
    return "NOT (thread_source = 'subagent' AND source LIKE '%guardian%')";
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
        onRetry: ({ attempt, delayMs, error }) => {
            console.warn('[spiracha:codex] SQLite read retry', {
                attempt,
                delayMs,
                error: error instanceof Error ? error.message : String(error),
            });
        },
    });
};

const withWritableDb = <T>(dbPath: string, callback: (db: Database) => T): T => {
    return runWithSqliteRetry({
        action: () => {
            const db = openWritableDb(dbPath, SQLITE_BUSY_TIMEOUT_MS);
            try {
                const result = callback(db);
                if (isPromiseLike(result)) {
                    throw new Error('Database callbacks must be synchronous');
                }

                return result;
            } finally {
                try {
                    db.close();
                } catch (error) {
                    console.warn('[spiracha:codex] SQLite close failed', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        },
    });
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

const readThreads = (dbPath: string, projectName: string | null = null): ThreadRow[] => {
    return withReadonlyDb(dbPath, (db) => {
        const filters = [getUserVisibleThreadFilter(db)];
        if (projectName) {
            filters.push(PROJECT_CWD_FILTER);
        }

        return db
            .query(
                `SELECT ${THREAD_ROW_COLUMNS} FROM threads
                 WHERE ${filters.join(' AND ')}
                 ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC`,
            )
            .all(...(projectName ? [projectName] : [])) as ThreadRow[];
    });
};

const resolveCodexDirFromDbPath = (dbPath: string) => {
    const dbDir = path.dirname(dbPath);
    return path.basename(dbDir) === 'sqlite' ? path.dirname(dbDir) : dbDir;
};

const resolveCodexLocalThreadCatalogDbPath = (dbPath: string) =>
    path.join(resolveCodexDirFromDbPath(dbPath), 'sqlite', 'codex-dev.db');

const resolveCodexHistoryDbPath = (dbPath: string) =>
    path.join(resolveCodexDirFromDbPath(dbPath), 'thread_history_1.sqlite');

const hasRegularFile = (filePath: string) => {
    try {
        return statSync(filePath).isFile();
    } catch {
        return false;
    }
};

const resolveCodexRolloutPath = (dbPath: string, rolloutPath: string) =>
    path.isAbsolute(rolloutPath) ? rolloutPath : path.join(resolveCodexDirFromDbPath(dbPath), rolloutPath);

const assertSafeCodexRolloutPaths = async (dbPath: string, rolloutPaths: string[]): Promise<void> => {
    const codexDir = path.resolve(resolveCodexDirFromDbPath(dbPath));
    const canonicalCodexDir = await realpath(codexDir).catch(() => codexDir);

    await Promise.all(
        rolloutPaths.map(async (rolloutPath) => {
            const resolvedPath = path.resolve(resolveCodexRolloutPath(dbPath, rolloutPath));
            const canonicalPath = await realpath(resolvedPath).catch(() => resolvedPath);
            const relativePath = path.relative(canonicalCodexDir, canonicalPath);
            if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
                throw new Error(`Unsafe Codex rollout path: ${rolloutPath}`);
            }
        }),
    );
};

export class CodexThreadNotFoundError extends Error {
    readonly code = 'CODEX_THREAD_NOT_FOUND';

    constructor(threadId: string) {
        super(`Thread not found: ${threadId}`);
        this.name = 'CodexThreadNotFoundError';
    }
}

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
    } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return;
        }
        throw error;
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
    const sessionIndexPath = path.join(codexDir, 'session_index.jsonl');
    let fingerprint = 'missing';
    try {
        const metadata = statSync(sessionIndexPath);
        fingerprint = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.ino}`;
    } catch {}
    const cached = sessionIndexEntriesCache.get(codexDir);
    if (cached?.fingerprint === fingerprint) {
        return cached.entries;
    }

    const entries = collectJsonlObjects<SessionIndexEntry>(sessionIndexPath).filter(
        (entry) => typeof entry.id === 'string' && entry.id.length > 0,
    );
    sessionIndexEntriesCache.set(codexDir, { entries, fingerprint });
    return entries;
};

const getSessionIndexThreadNamesById = (codexDir: string, suppliedEntries?: SessionIndexEntry[]) => {
    const threadNamesById = new Map<string, string>();
    for (const entry of suppliedEntries ?? readSessionIndexEntries(codexDir)) {
        const threadName = entry.thread_name?.trim();
        if (threadName) {
            threadNamesById.set(entry.id, threadName);
        }
    }
    return threadNamesById;
};

const applySessionIndexThreadNames = <T extends { id: string; title: string }>(
    dbPath: string,
    threads: T[],
    suppliedThreadNamesById?: Map<string, string>,
): T[] => {
    const threadNamesById =
        suppliedThreadNamesById ?? getSessionIndexThreadNamesById(resolveCodexDirFromDbPath(dbPath));
    return threads.map((thread) => {
        const threadName = threadNamesById.get(thread.id);
        return threadName ? { ...thread, title: threadName } : thread;
    });
};

const collectSessionFilesByThreadId = (sessionsDir: string): Map<string, string> => {
    const ambiguousThreadIds = new Set<string>();
    const sessionFiles = new Map<string, string>();
    const recordSessionFile = (fileName: string, filePath: string) => {
        const threadId = THREAD_ID_PATTERN.exec(fileName)?.[1];
        if (!threadId || ambiguousThreadIds.has(threadId)) {
            return;
        }
        if (sessionFiles.has(threadId)) {
            sessionFiles.delete(threadId);
            ambiguousThreadIds.add(threadId);
        } else {
            sessionFiles.set(threadId, filePath);
        }
    };
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

            recordSessionFile(entry.name, entryPath);
        }
    };

    visit(sessionsDir);
    return sessionFiles;
};

const getSessionFileIndexFingerprint = (sessionsDir: string) => {
    const toFingerprintPart = (targetPath: string) => {
        try {
            const metadata = statSync(targetPath);
            return `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.ino}`;
        } catch {
            return 'missing';
        }
    };

    return `${toFingerprintPart(path.join(path.dirname(sessionsDir), 'session_index.jsonl'))}:${toFingerprintPart(
        sessionsDir,
    )}`;
};

const getSessionFilesByThreadId = (sessionsDir: string, fingerprint = getSessionFileIndexFingerprint(sessionsDir)) => {
    const cached = sessionFileIndexCache.get(sessionsDir);
    if (cached?.fingerprint === fingerprint) {
        return cached.sessionFilesByThreadId;
    }

    const sessionFilesByThreadId = collectSessionFilesByThreadId(sessionsDir);
    sessionFileIndexCache.set(sessionsDir, {
        fingerprint,
        sessionFilesByThreadId,
    });
    return sessionFilesByThreadId;
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

    return lookup(getSessionFilesByThreadId(sessionsDir));
};

const readSessionMetaLine = (sessionFile: string): string | null => {
    let descriptor: number | null = null;
    try {
        descriptor = openSync(sessionFile, 'r');
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        while (totalBytes < SESSION_META_READ_LIMIT_BYTES) {
            const buffer = Buffer.alloc(
                Math.min(SESSION_META_READ_CHUNK_BYTES, SESSION_META_READ_LIMIT_BYTES - totalBytes),
            );
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

const parseFallbackDynamicTools = (sessionMeta: FallbackSessionMeta, threadId: string): DynamicToolRow[] => {
    if (!Array.isArray(sessionMeta.dynamic_tools)) {
        return [];
    }

    return sessionMeta.dynamic_tools.flatMap((value, position) => {
        const tool = objectOrNull(value);
        if (!tool) {
            return [];
        }

        return [
            {
                deferLoading: tool.deferLoading === true || tool.defer_loading === true,
                description: stringOrNull(tool.description) ?? '',
                inputSchema: (objectOrNull(tool.inputSchema) ??
                    objectOrNull(tool.input_schema)) as DynamicToolRow['inputSchema'],
                name: stringOrNull(tool.name) ?? 'unknown',
                namespace: stringOrNull(tool.namespace),
                position,
                threadId,
            },
        ];
    });
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

        const partialLine = pending + decoder.end();
        return Math.max(0, position - Buffer.byteLength(partialLine, 'utf8'));
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

const readFallbackRolloutStats = (sessionFile: string, knownFileStats?: Stats): FallbackRolloutStats => {
    const stats: FallbackRolloutStats = {
        model: null,
        tokensUsed: 0,
    };

    try {
        const fileStats = knownFileStats ?? statSync(sessionFile);
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
    rolloutMtimeMs: number,
): ThreadRow | null => {
    const cwd = stringOrNull(sessionMeta.cwd);
    if (!cwd) {
        return null;
    }

    const updatedAtMs = parseIsoMs(entry.updated_at, rolloutMtimeMs);
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
    let fileStats: Stats;
    try {
        fileStats = statSync(sessionFile);
    } catch {
        return null;
    }
    const fingerprint = `${fileStats.size}:${fileStats.mtimeMs}:${entry.thread_name ?? ''}:${entry.updated_at ?? ''}`;
    const cached = fallbackThreadRowCache.get(sessionFile);
    const sessionMeta = cached?.fingerprint === fingerprint ? cached.sessionMeta : readFallbackSessionMeta(sessionFile);
    if (!sessionMeta) {
        fallbackThreadRowCache.set(sessionFile, { fingerprint, row: null, sessionMeta: null });
        return null;
    }

    if (!options.includeSubagents && isFallbackSubagent(sessionMeta)) {
        return null;
    }

    const cwd = stringOrNull(sessionMeta.cwd);
    if (!cwd || (options.projectName && getPortablePathBasename(cwd) !== options.projectName)) {
        return null;
    }

    if (cached?.fingerprint === fingerprint) {
        return cached.row;
    }

    const row = buildFallbackThreadRow(
        entry,
        sessionFile,
        sessionMeta,
        readFallbackRolloutStats(sessionFile, fileStats),
        fileStats.mtimeMs,
    );
    fallbackThreadRowCache.set(sessionFile, { fingerprint, row, sessionMeta });
    return row;
};

const readFallbackThreadRows = (
    dbPath: string,
    existingThreadIds: Set<string>,
    projectName: string | null = null,
    options: ReadFallbackThreadRowsOptions = {},
): ThreadRow[] => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const sessionFilesByThreadId = getSessionFilesByThreadId(path.join(codexDir, 'sessions'));
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

type BrowseFilesystemData = {
    sessionFilesByThreadId: Map<string, string>;
    sessionIndexEntries: SessionIndexEntry[];
    sessionIndexThreadNames: Map<string, string>;
};

const readBrowseFilesystemData = (dbPath: string): BrowseFilesystemData => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const sessionsDir = path.join(codexDir, 'sessions');
    const sessionFileIndexFingerprint = getSessionFileIndexFingerprint(sessionsDir);
    const sessionIndexEntries = readSessionIndexEntries(codexDir);
    return {
        sessionFilesByThreadId: getSessionFilesByThreadId(sessionsDir, sessionFileIndexFingerprint),
        sessionIndexEntries,
        sessionIndexThreadNames: getSessionIndexThreadNamesById(codexDir, sessionIndexEntries),
    };
};

const readFallbackThreadRowById = (
    dbPath: string,
    threadId: string,
    options: ReadFallbackThreadRowsOptions = {},
    suppliedFilesystemData?: BrowseFilesystemData,
): ThreadRow | null => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const entry = (suppliedFilesystemData?.sessionIndexEntries ?? readSessionIndexEntries(codexDir)).find(
        (candidate) => candidate.id === threadId,
    );
    if (!entry) {
        return null;
    }

    const sessionFile = suppliedFilesystemData
        ? (suppliedFilesystemData.sessionFilesByThreadId.get(threadId) ?? null)
        : findSessionFileByThreadId(path.join(codexDir, 'sessions'), threadId);
    if (!sessionFile) {
        return null;
    }

    return readFallbackThreadRow(entry, sessionFile, options);
};

const mergeFallbackThreadRows = (dbPath: string, threads: ThreadRow[], projectName: string | null = null) => {
    const titledThreads = applySessionIndexThreadNames(dbPath, threads);
    const threadIds = new Set(titledThreads.map((thread) => thread.id));
    return [...titledThreads, ...readFallbackThreadRows(dbPath, threadIds, projectName)].sort(
        compareThreadsByRecentActivity,
    );
};

const applyRolloutActivityTimestamps = async <T extends ActivityTimestampedThread>(
    dbPath: string,
    threads: T[],
): Promise<T[]> => {
    const activeThreads = await mapWithConcurrency(threads, THREAD_LIST_IO_CONCURRENCY, async (thread): Promise<T> => {
        const rolloutPath = resolveCodexRolloutPath(dbPath, thread.rollout_path);
        const normalizedThread =
            rolloutPath === thread.rollout_path ? thread : { ...thread, rollout_path: rolloutPath };
        let rolloutUpdatedAtMs = getThreadUpdatedAtMs(thread);
        try {
            rolloutUpdatedAtMs = Math.max(rolloutUpdatedAtMs, (await stat(rolloutPath)).mtimeMs);
        } catch {}

        if (rolloutUpdatedAtMs <= getThreadUpdatedAtMs(thread)) {
            return normalizedThread;
        }

        return {
            ...normalizedThread,
            updated_at: Math.floor(rolloutUpdatedAtMs / 1000),
            updated_at_ms: Math.floor(rolloutUpdatedAtMs),
        };
    });

    return activeThreads.sort(compareThreadsByRecentActivity);
};

type ThreadDisplaySource = Pick<ThreadRow, 'first_user_message' | 'preview' | 'title'> &
    Partial<Pick<ThreadRow, 'agent_nickname' | 'agent_path'>>;

const normalizeThreadDisplayText = <T extends ThreadDisplaySource>(thread: T): T => {
    const title = cleanInlineTitle(thread.title);
    const firstUserMessage = cleanInlineTitle(thread.first_user_message);
    const preview = cleanInlineTitle(thread.preview);
    const agentNickname = cleanInlineTitle(thread.agent_nickname ?? '');
    const agentPath = thread.agent_path?.trim() ?? '';

    return {
        ...thread,
        preview:
            preview ||
            firstUserMessage ||
            (agentPath ? `Agent path: ${agentPath}` : 'No transcript preview available.'),
        title:
            title ||
            firstUserMessage ||
            preview ||
            (agentNickname ? `${agentNickname} (subagent)` : 'Untitled Codex thread'),
    };
};

const compactDashboardThread = (thread: DashboardThreadCandidate): DashboardThreadSummary => {
    const normalizedThread = normalizeThreadDisplayText(thread);
    return {
        cwd: normalizedThread.cwd,
        id: normalizedThread.id,
        model: normalizedThread.model,
        preview: normalizedThread.preview,
        title: normalizedThread.title,
        tokens_used: normalizedThread.tokens_used,
        updated_at: normalizedThread.updated_at,
        updated_at_ms: normalizedThread.updated_at_ms,
    };
};

const buildDashboardRecentThreads = (threads: DashboardThreadCandidate[]) => {
    const bestThreadByProject = new Map<string, DashboardThreadCandidate>();
    for (const thread of threads) {
        const project = getPortablePathBasename(thread.cwd);
        if (!project) {
            continue;
        }

        const current = bestThreadByProject.get(project);
        if (!current || getThreadUpdatedAtMs(thread) > getThreadUpdatedAtMs(current)) {
            bestThreadByProject.set(project, thread);
        }
    }

    return [...bestThreadByProject.values()]
        .sort(compareThreadsByRecentActivity)
        .slice(0, DASHBOARD_RESULT_LIMIT)
        .map((thread) => ({
            project: getPortablePathBasename(thread.cwd),
            thread: compactDashboardThread(thread),
        }));
};

const buildProjectSummaryMap = (threads: ThreadRow[]) => {
    const projectMap: ProjectSummaryMap = new Map();

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
        current.lastUpdatedAtMs = Math.max(current.lastUpdatedAtMs ?? 0, getThreadUpdatedAtMs(thread));
        if (thread.model) {
            current.modelNames.add(thread.model);
        }
        current.threadCount += 1;
        current.totalTokens += thread.tokens_used;
        projectMap.set(projectName, current);
    }

    return projectMap;
};

const mergeProjectAggregateRows = (projectMap: ProjectSummaryMap, rows: ProjectAggregateRow[]) => {
    for (const row of rows) {
        const projectName = getPortablePathBasename(row.cwd);
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
        current.archivedThreadCount += Number(row.archived_thread_count);
        current.cwdPaths.add(row.cwd);
        current.lastUpdatedAtMs = Math.max(current.lastUpdatedAtMs ?? 0, Number(row.last_updated_at_ms ?? 0));
        if (row.model) {
            current.modelNames.add(row.model);
        }
        current.threadCount += Number(row.thread_count);
        current.totalTokens += Number(row.total_tokens);
        projectMap.set(projectName, current);
    }

    return projectMap;
};

const mapProjectSummaries = (projectMap: ProjectSummaryMap): ProjectSummary[] => {
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

            return compareCodeUnits(left.name, right.name);
        });
};

const getExistingTableNames = (db: Database) => {
    const rows = db.query('SELECT name FROM sqlite_master WHERE type = ?').all('table') as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
};

const getExistingCodexHistoryTableNames = (db: Database) => {
    const rows = db.query('SELECT name FROM codex_history.sqlite_master WHERE type = ?').all('table') as Array<{
        name: string;
    }>;
    return new Set(rows.map((row) => row.name));
};

type ThreadSpawnEdge = SpawnEdgeRow;

const readThreadHierarchyEdges = (db: Database, threadIds: string[]): ThreadSpawnEdge[] => {
    if (!getExistingTableNames(db).has('thread_spawn_edges')) {
        return [];
    }

    const seenEdges = new Set<string>();
    const edges: ThreadSpawnEdge[] = [];
    for (const threadIdChunk of chunkValues(threadIds, SQLITE_DELETE_BATCH_SIZE)) {
        const placeholders = threadIdChunk.map(() => '?').join(', ');
        const matchingEdges = db
            .query(
                `SELECT parent_thread_id, child_thread_id
                 FROM thread_spawn_edges
                 WHERE parent_thread_id IN (${placeholders}) OR child_thread_id IN (${placeholders})`,
            )
            .all(...threadIdChunk, ...threadIdChunk) as ThreadSpawnEdge[];

        for (const edge of matchingEdges) {
            const edgeKey = `${edge.parent_thread_id}\0${edge.child_thread_id}`;
            if (!seenEdges.has(edgeKey)) {
                seenEdges.add(edgeKey);
                edges.push(edge);
            }
        }
    }

    return edges;
};

const applyThreadHierarchyEdges = (
    hierarchyById: Map<string, ThreadListEntry['hierarchy']>,
    edges: ThreadSpawnEdge[],
) => {
    for (const edge of edges) {
        const parent = hierarchyById.get(edge.parent_thread_id);
        if (parent) {
            parent.childThreadCount += 1;
        }

        const child = hierarchyById.get(edge.child_thread_id);
        if (child) {
            child.parentThreadId = edge.parent_thread_id;
        }
    }
};

const getThreadHierarchyById = (dbPath: string, threadIds: string[]) => {
    const hierarchyById = new Map<string, ThreadListEntry['hierarchy']>(
        threadIds.map((threadId) => [threadId, { childThreadCount: 0, parentThreadId: null }]),
    );
    if (threadIds.length === 0) {
        return hierarchyById;
    }

    return withReadonlyDb(dbPath, (db) => {
        applyThreadHierarchyEdges(hierarchyById, readThreadHierarchyEdges(db, threadIds));
        return hierarchyById;
    });
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

const deleteStateThreadRows = (db: Database, existingTableNames: Set<string>, threadIds: string[]) => {
    if (threadIds.length === 0) {
        return;
    }

    const placeholders = threadIds.map(() => '?').join(', ');

    // Codex schema differs across versions, so only touch dependent tables that actually exist.
    if (existingTableNames.has('thread_dynamic_tools')) {
        db.query(`DELETE FROM thread_dynamic_tools WHERE thread_id IN (${placeholders})`).run(...threadIds);
    }

    if (existingTableNames.has('thread_goals')) {
        db.query(`DELETE FROM thread_goals WHERE thread_id IN (${placeholders})`).run(...threadIds);
    }

    if (existingTableNames.has('stage1_outputs')) {
        db.query(`DELETE FROM stage1_outputs WHERE thread_id IN (${placeholders})`).run(...threadIds);
    }

    if (existingTableNames.has('thread_spawn_edges')) {
        db.query(
            `DELETE FROM thread_spawn_edges WHERE parent_thread_id IN (${placeholders}) OR child_thread_id IN (${placeholders})`,
        ).run(...threadIds, ...threadIds);
    }

    db.query(`DELETE FROM threads WHERE id IN (${placeholders})`).run(...threadIds);
};

const deleteHistoryThreadRows = (db: Database, historyTableNames: Set<string>, threadIds: string[]) => {
    if (threadIds.length === 0) {
        return;
    }

    const placeholders = threadIds.map(() => '?').join(', ');
    if (historyTableNames.has('thread_items')) {
        db.query(`DELETE FROM codex_history.thread_items WHERE thread_id IN (${placeholders})`).run(...threadIds);
    }

    if (historyTableNames.has('thread_turns')) {
        db.query(`DELETE FROM codex_history.thread_turns WHERE thread_id IN (${placeholders})`).run(...threadIds);
    }

    if (historyTableNames.has('thread_history_projection_state')) {
        db.query(`DELETE FROM codex_history.thread_history_projection_state WHERE thread_id IN (${placeholders})`).run(
            ...threadIds,
        );
    }
};

const deleteThreadIds = (db: Database, dbPath: string, threadIds: string[]): DeleteThreadMutationResult => {
    const uniqueThreadIds = uniqueValues(threadIds);
    if (uniqueThreadIds.length === 0) {
        return { deletedRolloutPaths: [], deletedThreadIds: [] };
    }

    let threadTargets: Array<{ id: string; rollout_path: string }> = [];
    let existingIds: string[] = [];
    let historyAttached = false;
    try {
        withSqliteTransaction(db, (transactionDb) => {
            const existingTableNames = getExistingTableNames(transactionDb);
            threadTargets = getThreadDeleteTargets(transactionDb, uniqueThreadIds);
            existingIds = threadTargets.map((target) => target.id);
            const existingIdSet = new Set(existingIds);
            const historyDbPath = resolveCodexHistoryDbPath(dbPath);
            if (hasRegularFile(historyDbPath)) {
                // SQLite coordinates this transaction across the attached database for normal commits. A process
                // crash during WAL commit is not claimed to be crash-atomic across both database files.
                transactionDb.query('ATTACH DATABASE ? AS codex_history').run(historyDbPath);
                historyAttached = true;
            }

            const historyTableNames = historyAttached
                ? getExistingCodexHistoryTableNames(transactionDb)
                : new Set<string>();
            for (const threadIdChunk of chunkValues(uniqueThreadIds, SQLITE_DELETE_BATCH_SIZE)) {
                const stateThreadIds = threadIdChunk.filter((threadId) => existingIdSet.has(threadId));
                deleteStateThreadRows(transactionDb, existingTableNames, stateThreadIds);
                deleteHistoryThreadRows(transactionDb, historyTableNames, threadIdChunk);
            }
        });
    } finally {
        if (historyAttached) {
            try {
                db.query('DETACH DATABASE codex_history').run();
            } catch (error) {
                console.warn('[spiracha:codex] SQLite history detach failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    return {
        deletedRolloutPaths: threadTargets.map((target) => target.rollout_path),
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

    const sessionFilesByThreadId = getSessionFilesByThreadId(path.join(codexDir, 'sessions'));
    return threadIds
        .map((threadId) => sessionFilesByThreadId.get(threadId))
        .filter((value): value is string => Boolean(value));
};

const validateSessionFileDeletionTargets = async (dbPath: string, threadIds: string[]): Promise<void> => {
    const dbSessionFiles = withReadonlyDb(dbPath, (db) =>
        getThreadDeleteTargets(db, threadIds).map((target) => target.rollout_path),
    );
    await assertSafeCodexRolloutPaths(dbPath, [...dbSessionFiles, ...getSessionFilesForThreadIds(dbPath, threadIds)]);
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

export const mergeSessionIndexLinesForRewrite = (
    initialLines: string[],
    retainedLines: string[],
    currentLines: string[],
    deletedThreadIds: Set<string>,
) => {
    const initial = new Set(initialLines.map((line) => line.trim()).filter(Boolean));
    const merged = retainedLines.map((line) => line.trim()).filter(Boolean);
    const included = new Set(merged);

    for (const line of currentLines) {
        const trimmed = line.trim();
        if (!trimmed || initial.has(trimmed) || included.has(trimmed)) {
            continue;
        }
        const entry = parseJsonlObject<SessionIndexEntry>(trimmed);
        if (entry?.id && deletedThreadIds.has(entry.id)) {
            continue;
        }
        merged.push(trimmed);
        included.add(trimmed);
    }

    return merged;
};

const writeSessionIndexLines = async (
    sessionIndexPath: string,
    codexDir: string,
    initialLines: string[],
    retainedLines: string[],
    deletedThreadIds: Set<string>,
) => {
    const tempSessionIndexPath = path.join(
        codexDir,
        `.session_index.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
        const currentLines = (await Bun.file(sessionIndexPath).text()).split(/\r?\n/u);
        const mergedLines = mergeSessionIndexLinesForRewrite(
            initialLines,
            retainedLines,
            currentLines,
            deletedThreadIds,
        );
        await Bun.write(tempSessionIndexPath, mergedLines.length > 0 ? `${mergedLines.join('\n')}\n` : '');
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

        await writeSessionIndexLines(sessionIndexPath, codexDir, lines, retainedLines, uniqueThreadIds);
        return uniqueValues(removedThreadIds);
    };

    const mutation = sessionIndexMutationQueue.then(runMutation, runMutation);
    sessionIndexMutationQueue = mutation.then(
        () => undefined,
        () => undefined,
    );
    return mutation;
};

const removeLocalThreadCatalogEntries = (dbPath: string, threadIds: string[]) => {
    const uniqueThreadIds = uniqueValues(threadIds);
    if (uniqueThreadIds.length === 0) {
        return [];
    }

    const catalogDbPath = resolveCodexLocalThreadCatalogDbPath(dbPath);
    if (!hasRegularFile(catalogDbPath)) {
        return [];
    }

    return withWritableDb(catalogDbPath, (db) => {
        const catalogTable = db
            .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_thread_catalog'")
            .get() as { name?: string } | null;
        if (catalogTable?.name !== 'local_thread_catalog') {
            return [];
        }

        const removedThreadIds: string[] = [];
        withSqliteTransaction(db, (transactionDb) => {
            for (const threadIdChunk of chunkValues(uniqueThreadIds, SQLITE_DELETE_BATCH_SIZE)) {
                const placeholders = threadIdChunk.map(() => '?').join(', ');
                const existingRows = transactionDb
                    .query(`SELECT thread_id FROM local_thread_catalog WHERE thread_id IN (${placeholders})`)
                    .all(...threadIdChunk) as Array<{ thread_id: string }>;
                removedThreadIds.push(...existingRows.map((row) => row.thread_id));
                transactionDb
                    .query(`DELETE FROM local_thread_catalog WHERE thread_id IN (${placeholders})`)
                    .run(...threadIdChunk);
            }
        });

        return uniqueValues(removedThreadIds);
    });
};

const listFallbackThreadIdsForProject = (dbPath: string, existingThreadIds: Set<string>, projectName: string) => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const sessionFilesByThreadId = getSessionFilesByThreadId(path.join(codexDir, 'sessions'));
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
    const fallbackSessionFiles = deleteSessionFiles ? getSessionFilesForThreadIds(dbPath, threadIds) : [];
    const deletedSessionFiles = deleteSessionFiles
        ? await deleteThreadSessionFiles([
              ...dbDeletedSessionFiles.map((sessionFile) => resolveCodexRolloutPath(dbPath, sessionFile)),
              ...fallbackSessionFiles,
          ])
        : [];
    const removedThreadIds = await removeSessionIndexEntries(codexDir, threadIds);
    const localThreadCatalogThreadIds = removeLocalThreadCatalogEntries(dbPath, threadIds);
    const globalStateResults = await Promise.all(
        ['.codex-global-state.json', '.codex-global-state.json.bak'].map((fileName) =>
            removeCodexGlobalStateThreadReferencesFromFile(path.join(codexDir, fileName), threadIds),
        ),
    );

    return {
        deletedSessionFiles,
        deletedThreadIds: removedThreadIds,
        globalStateThreadIds: uniqueValues(globalStateResults.flatMap((result) => result.removedThreadIds)),
        globalStateWritingBlockThreadIds: uniqueValues(
            globalStateResults.flatMap((result) => result.writingBlockFlagsSet),
        ),
        localThreadCatalogThreadIds,
    };
};

const buildDeleteThreadsResult = (
    sessionIndexResult: Awaited<ReturnType<typeof deleteSessionIndexEntriesForThreads>>,
    deleteSessionFiles: boolean | undefined,
    deletedThreadIds: string[],
): DeleteThreadsResult => ({
    cleanup: {
        globalStateReferencesRemoved: sessionIndexResult.globalStateThreadIds,
        globalStateWritingBlocksSet: sessionIndexResult.globalStateWritingBlockThreadIds,
        localThreadCatalogEntriesRemoved: sessionIndexResult.localThreadCatalogThreadIds,
        requested: Boolean(deleteSessionFiles),
        sessionIndexEntriesRemoved: sessionIndexResult.deletedThreadIds,
    },
    deletedSessionFiles: sessionIndexResult.deletedSessionFiles,
    deletedThreadIds: uniqueValues([
        ...deletedThreadIds,
        ...sessionIndexResult.deletedThreadIds,
        ...sessionIndexResult.localThreadCatalogThreadIds,
        ...sessionIndexResult.globalStateThreadIds,
    ]),
});

const readProjectAggregateRows = (db: Database) => {
    return db
        .query(`
            SELECT
                cwd,
                model,
                SUM(CASE WHEN archived <> 0 THEN 1 ELSE 0 END) AS archived_thread_count,
                MAX(COALESCE(updated_at_ms, updated_at * 1000)) AS last_updated_at_ms,
                COUNT(*) AS thread_count,
                COALESCE(SUM(tokens_used), 0) AS total_tokens
            FROM threads
            WHERE ${getUserVisibleThreadFilter(db)}
              AND typeof(cwd) = 'text' AND TRIM(cwd) <> ''
            GROUP BY cwd, model
        `)
        .all() as ProjectAggregateRow[];
};

const readDbThreadIds = (db: Database) => {
    const rows = db.query('SELECT id FROM threads').all() as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
};

export const reconcileCodexSessionIndex = (dbPath: string): CodexSessionIndexReconciliation => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const existingThreadIds = withReadonlyDb(dbPath, (db) => readDbThreadIds(db));
    const sessionFilesByThreadId = getSessionFilesByThreadId(path.join(codexDir, 'sessions'));
    const staleEntries = readSessionIndexEntries(codexDir).filter(
        (entry) => !existingThreadIds.has(entry.id) && !sessionFilesByThreadId.has(entry.id),
    );

    return {
        dryRun: true,
        staleEntries,
    };
};

const readProjectSummaryDatabaseData = (dbPath: string) => {
    return withReadonlyDb(dbPath, (db) => ({
        existingThreadIds: readDbThreadIds(db),
        projectAggregates: readProjectAggregateRows(db),
    }));
};

export const listCodexProjects = async (dbPath: string): Promise<ProjectSummary[]> => {
    const database = readProjectSummaryDatabaseData(dbPath);
    const fallbackThreads = readFallbackThreadRows(dbPath, database.existingThreadIds);

    return mapProjectSummaries(
        mergeProjectAggregateRows(buildProjectSummaryMap(fallbackThreads), database.projectAggregates),
    );
};

type ListProjectThreadsOptions = {
    includeTranscriptStats?: boolean;
    largeTranscriptThresholdBytes?: number;
};

const compactThreadListRow = (thread: ThreadRow): ThreadRow => {
    return normalizeThreadDisplayText(thread);
};

export const listProjectThreads = async (
    dbPath: string,
    projectName: string,
    options: ListProjectThreadsOptions = {},
): Promise<ThreadListEntry[]> => {
    const threads = mergeFallbackThreadRows(dbPath, readThreads(dbPath, projectName), projectName);
    const activeThreads = await applyRolloutActivityTimestamps(dbPath, threads);
    const hierarchyByThreadId = getThreadHierarchyById(
        dbPath,
        activeThreads.map((thread) => thread.id),
    );
    const entries = await mapWithConcurrency(activeThreads, THREAD_LIST_IO_CONCURRENCY, async (thread) => {
        const rollout = await getThreadRolloutLoadState(thread.rollout_path, options.largeTranscriptThresholdBytes);
        const hierarchy = hierarchyByThreadId.get(thread.id) ?? { childThreadCount: 0, parentThreadId: null };
        const detectedModelNames =
            rollout.fileSizeBytes === null ? [] : await getCachedCodexTranscriptModelNames(thread.rollout_path);
        const modelNames = detectedModelNames.length > 0 ? detectedModelNames : thread.model ? [thread.model] : [];

        if (rollout.fileSizeBytes === null) {
            return {
                hierarchy,
                modelNames,
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
                hierarchy,
                modelNames,
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

        const stats = await getCachedCodexTranscriptStats(thread.rollout_path);

        return {
            hierarchy,
            modelNames,
            project: projectName,
            rolloutSizeBytes: rollout.fileSizeBytes,
            stats: {
                deferred: false,
                execCommandCount: stats.execCommandCount,
                toolCallCount: stats.toolCallCount,
                webSearchEventCount: stats.webSearchEventCount,
            },
            thread: compactThreadListRow(thread),
        };
    });

    return entries.sort((left, right) => compareThreadsByRecentActivity(left.thread, right.thread));
};

type ThreadBrowseDatabaseData = {
    dynamicToolsByThreadId: Map<string, DynamicToolRow[]>;
    goalsByThreadId: Map<string, ThreadGoalRow[]>;
    relationsByThreadId: Map<string, ThreadRelations>;
    threadsById: Map<string, ThreadRow>;
};

const readBrowseThreadRows = (db: Database, threadIdChunk: string[], threadsById: Map<string, ThreadRow>) => {
    const placeholders = threadIdChunk.map(() => '?').join(', ');
    const rows = db
        .query(`SELECT ${THREAD_ROW_COLUMNS} FROM threads WHERE id IN (${placeholders})`)
        .all(...threadIdChunk) as unknown[];
    for (const row of rows) {
        const thread = decodeThreadRow(row);
        threadsById.set(thread.id, thread);
    }
};

const readBrowseDynamicTools = (
    db: Database,
    threadIdChunk: string[],
    dynamicToolsByThreadId: Map<string, DynamicToolRow[]>,
) => {
    const placeholders = threadIdChunk.map(() => '?').join(', ');
    const rows = db
        .query(
            `SELECT thread_id, position, name, description, input_schema, defer_loading, namespace
             FROM thread_dynamic_tools
             WHERE thread_id IN (${placeholders})
             ORDER BY thread_id ASC, position ASC`,
        )
        .all(...threadIdChunk) as unknown[];
    for (const row of rows) {
        const tool = parseDynamicToolRow(row);
        const tools = dynamicToolsByThreadId.get(tool.threadId) ?? [];
        tools.push(tool);
        dynamicToolsByThreadId.set(tool.threadId, tools);
    }
};

const readBrowseGoals = (db: Database, threadIdChunk: string[], goalsByThreadId: Map<string, ThreadGoalRow[]>) => {
    const placeholders = threadIdChunk.map(() => '?').join(', ');
    const rows = db
        .query(
            `SELECT thread_id, goal_id, objective, status, token_budget, tokens_used,
                    time_used_seconds, created_at_ms, updated_at_ms
             FROM thread_goals
             WHERE thread_id IN (${placeholders})
             ORDER BY thread_id ASC, updated_at_ms DESC, goal_id ASC`,
        )
        .all(...threadIdChunk) as unknown[];
    for (const row of rows) {
        const values = row as Record<string, unknown>;
        if (typeof values.thread_id !== 'string') {
            throw new CodexDbCompatibilityError(CODEX_BROWSE_SCHEMA_PROFILE, [], [], ['thread_goals.thread_id']);
        }
        const goals = goalsByThreadId.get(values.thread_id) ?? [];
        goals.push(decodeThreadGoalRow(row));
        goalsByThreadId.set(values.thread_id, goals);
    }
};

const readBrowseRelations = (
    db: Database,
    threadIdChunk: string[],
    relationsByThreadId: Map<string, ThreadRelations>,
    seenEdgeIds: Set<string>,
) => {
    const placeholders = threadIdChunk.map(() => '?').join(', ');
    const rows = db
        .query(
            `SELECT parent_thread_id, child_thread_id, status
             FROM thread_spawn_edges
             WHERE parent_thread_id IN (${placeholders}) OR child_thread_id IN (${placeholders})
             ORDER BY parent_thread_id ASC, child_thread_id ASC`,
        )
        .all(...threadIdChunk, ...threadIdChunk) as unknown[];
    for (const row of rows) {
        const edge = decodeThreadSpawnEdgeRow(row);
        const edgeId = `${edge.parent_thread_id}\u0000${edge.child_thread_id}\u0000${edge.status}`;
        if (seenEdgeIds.has(edgeId)) {
            continue;
        }
        seenEdgeIds.add(edgeId);
        const parentRelations = relationsByThreadId.get(edge.parent_thread_id);
        if (parentRelations) {
            parentRelations.childEdges.push(edge);
        }
        const childRelations = relationsByThreadId.get(edge.child_thread_id);
        if (childRelations) {
            childRelations.parentThreadId = edge.parent_thread_id;
        }
    }
};

const readThreadBrowseDatabaseData = (dbPath: string, requestedThreadIds: string[]): ThreadBrowseDatabaseData => {
    const threadIds = uniqueValues(requestedThreadIds);
    return withReadonlyDb(dbPath, (db) =>
        withSqliteTransaction(db, (snapshotDb) => {
            const existingTableNames = assertCodexSchemaCompatibility(snapshotDb, CODEX_BROWSE_SCHEMA_PROFILE);
            const threadsById = new Map<string, ThreadRow>();
            const dynamicToolsByThreadId = new Map<string, DynamicToolRow[]>();
            const goalsByThreadId = new Map<string, ThreadGoalRow[]>();
            const relationsByThreadId = new Map<string, ThreadRelations>(
                threadIds.map((threadId) => [threadId, { childEdges: [], parentThreadId: null }]),
            );
            const seenEdgeIds = new Set<string>();

            for (const threadIdChunk of chunkValues(threadIds, SQLITE_DELETE_BATCH_SIZE)) {
                readBrowseThreadRows(snapshotDb, threadIdChunk, threadsById);
                if (existingTableNames.has('thread_dynamic_tools')) {
                    readBrowseDynamicTools(snapshotDb, threadIdChunk, dynamicToolsByThreadId);
                }

                if (existingTableNames.has('thread_goals')) {
                    readBrowseGoals(snapshotDb, threadIdChunk, goalsByThreadId);
                }

                if (existingTableNames.has('thread_spawn_edges')) {
                    readBrowseRelations(snapshotDb, threadIdChunk, relationsByThreadId, seenEdgeIds);
                }
            }

            return { dynamicToolsByThreadId, goalsByThreadId, relationsByThreadId, threadsById };
        }),
    );
};

const buildThreadBrowseData = (
    dbPath: string,
    thread: ThreadRow,
    source: 'database' | 'fallback',
    databaseData: ThreadBrowseDatabaseData | null,
    filesystemData?: BrowseFilesystemData,
): ThreadBrowseData => {
    // Session-index titles and fallback transcript metadata are filesystem reads and intentionally happen after
    // the SQLite snapshot has committed.
    const indexedThread = applySessionIndexThreadNames(dbPath, [thread], filesystemData?.sessionIndexThreadNames)[0]!;
    const normalizedThread = normalizeThreadDisplayText({
        ...indexedThread,
        rollout_path: resolveCodexRolloutPath(dbPath, indexedThread.rollout_path),
    });
    const dynamicTools =
        source === 'database'
            ? (databaseData?.dynamicToolsByThreadId.get(thread.id) ?? [])
            : parseFallbackDynamicTools(readFallbackSessionMeta(normalizedThread.rollout_path) ?? {}, thread.id);
    const goals = source === 'database' ? (databaseData?.goalsByThreadId.get(thread.id) ?? []) : [];
    const relations =
        source === 'database'
            ? (databaseData?.relationsByThreadId.get(thread.id) ?? { childEdges: [], parentThreadId: null })
            : { childEdges: [], parentThreadId: null };

    return {
        dynamicTools,
        goals: goals.map((goal) => ({
            createdAtMs: goal.created_at_ms,
            goalId: goal.goal_id,
            objective: goal.objective,
            status: goal.status,
            timeUsedSeconds: goal.time_used_seconds,
            tokenBudget: goal.token_budget,
            tokensUsed: goal.tokens_used,
            updatedAtMs: goal.updated_at_ms,
        })),
        project: getPortablePathBasename(normalizedThread.cwd),
        relations,
        thread: normalizedThread,
    };
};

export const getThreadBrowseDataBatch = (dbPath: string, threadIds: string[]): CodexThreadBrowseBatchResult[] => {
    if (threadIds.length === 0) {
        return [];
    }

    const filesystemData = readBrowseFilesystemData(dbPath);
    const databaseData = readThreadBrowseDatabaseData(dbPath, threadIds);
    const fallbackThreadsById = new Map<string, ThreadRow>();
    for (const threadId of uniqueValues(threadIds)) {
        if (databaseData.threadsById.has(threadId)) {
            continue;
        }
        const fallbackThread = readFallbackThreadRowById(dbPath, threadId, { includeSubagents: true }, filesystemData);
        if (fallbackThread) {
            fallbackThreadsById.set(threadId, fallbackThread);
        }
    }

    return threadIds.map((threadId) => {
        const databaseThread = databaseData.threadsById.get(threadId);
        if (databaseThread) {
            return {
                data: buildThreadBrowseData(dbPath, databaseThread, 'database', databaseData, filesystemData),
                source: 'database',
                status: 'found',
                threadId,
            };
        }

        const fallbackThread = fallbackThreadsById.get(threadId);
        if (fallbackThread) {
            return {
                data: buildThreadBrowseData(dbPath, fallbackThread, 'fallback', null, filesystemData),
                source: 'fallback',
                status: 'found',
                threadId,
            };
        }

        return {
            data: null,
            source: 'missing',
            status: 'missing',
            threadId,
        };
    });
};

export const getThreadBrowseData = (dbPath: string, threadId: string): ThreadBrowseData => {
    const result = getThreadBrowseDataBatch(dbPath, [threadId])[0]!;
    if (result.status === 'missing') {
        throw new CodexThreadNotFoundError(threadId);
    }
    return result.data;
};

type DashboardDatabaseTotals = {
    archived_threads: number;
    total_threads: number;
    total_tokens: number;
};

const readDashboardDatabaseData = (dbPath: string) => {
    return withReadonlyDb(dbPath, (db) => {
        const totals = db
            .query(`
                SELECT
                    SUM(CASE WHEN archived <> 0 THEN 1 ELSE 0 END) AS archived_threads,
                    COUNT(*) AS total_threads,
                    COALESCE(SUM(tokens_used), 0) AS total_tokens
                FROM threads
                WHERE ${getUserVisibleThreadFilter(db)}
            `)
            .get() as DashboardDatabaseTotals;
        const recentCandidates = db
            .query(`
                SELECT
                    id,
                    rollout_path,
                    cwd,
                    title,
                    preview,
                    first_user_message,
                    model,
                    tokens_used,
                    updated_at,
                    updated_at_ms
                FROM threads
                WHERE ${getUserVisibleThreadFilter(db)}
                  AND typeof(cwd) = 'text' AND TRIM(cwd) <> ''
            `)
            .all() as DashboardThreadCandidate[];
        const existingTableNames = getExistingTableNames(db);
        const relationCount = existingTableNames.has('thread_spawn_edges')
            ? (
                  db
                      .query(`
                      SELECT COUNT(*) AS count
                      FROM (
                          SELECT parent_thread_id AS thread_id FROM thread_spawn_edges
                          UNION
                          SELECT child_thread_id AS thread_id FROM thread_spawn_edges
                      )
                  `)
                      .get() as { count: number }
              ).count
            : 0;

        return {
            existingThreadIds: readDbThreadIds(db),
            projectAggregates: readProjectAggregateRows(db),
            recentCandidates,
            relationCount: Number(relationCount),
            totals,
        };
    });
};

export const getCodexDashboardSummary = async (dbPath: string): Promise<DashboardSummary> => {
    const database = readDashboardDatabaseData(dbPath);
    const fallbackThreads = readFallbackThreadRows(dbPath, database.existingThreadIds);
    const recentCandidates = await applyRolloutActivityTimestamps(dbPath, [
        ...applySessionIndexThreadNames(dbPath, database.recentCandidates),
        ...fallbackThreads,
    ]);
    const projects = mapProjectSummaries(
        mergeProjectAggregateRows(buildProjectSummaryMap(fallbackThreads), database.projectAggregates),
    );
    const fallbackArchivedThreads = fallbackThreads.filter((thread) => Boolean(thread.archived)).length;
    const archivedThreads = Number(database.totals.archived_threads ?? 0) + fallbackArchivedThreads;
    const totalThreads = Number(database.totals.total_threads) + fallbackThreads.length;

    return {
        activeThreads: totalThreads - archivedThreads,
        archivedThreads,
        recentThreads: buildDashboardRecentThreads(recentCandidates),
        threadsWithRelations: database.relationCount,
        topProjectsByThreadCount: [...projects]
            .sort((left, right) => {
                if (left.threadCount !== right.threadCount) {
                    return right.threadCount - left.threadCount;
                }

                return compareCodeUnits(left.name, right.name);
            })
            .slice(0, DASHBOARD_RESULT_LIMIT),
        topProjectsByTokens: projects.slice(0, DASHBOARD_RESULT_LIMIT),
        totalProjects: projects.length,
        totalThreads,
        totalTokens:
            Number(database.totals.total_tokens) + fallbackThreads.reduce((sum, thread) => sum + thread.tokens_used, 0),
    };
};

export const deleteCodexThread = async (
    dbPath: string,
    threadId: string,
    options: DeleteThreadOptions = {},
): Promise<DeleteThreadsResult> => {
    const threadIds = [threadId];
    if (options.deleteSessionFiles) {
        await validateSessionFileDeletionTargets(dbPath, threadIds);
    }
    const result = withWritableDb(dbPath, (db) => {
        return deleteThreadIds(db, dbPath, threadIds);
    });

    try {
        const sessionIndexResult = await deleteSessionIndexEntriesForThreads(
            dbPath,
            threadIds,
            result.deletedRolloutPaths,
            Boolean(options.deleteSessionFiles),
        );

        return buildDeleteThreadsResult(sessionIndexResult, options.deleteSessionFiles, result.deletedThreadIds);
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
    if (options.deleteSessionFiles) {
        await validateSessionFileDeletionTargets(dbPath, uniqueThreadIds);
    }
    const result = withWritableDb(dbPath, (db) => {
        return deleteThreadIds(db, dbPath, uniqueThreadIds);
    });

    try {
        const sessionIndexResult = await deleteSessionIndexEntriesForThreads(
            dbPath,
            uniqueThreadIds,
            result.deletedRolloutPaths,
            Boolean(options.deleteSessionFiles),
        );

        return buildDeleteThreadsResult(sessionIndexResult, options.deleteSessionFiles, result.deletedThreadIds);
    } finally {
        await invalidateCodexUiCaches();
    }
};

export const deleteCodexProject = async (
    dbPath: string,
    projectName: string,
    options: DeleteProjectOptions = {},
): Promise<DeleteProjectResult> => {
    const existingThreadIds = new Set(
        withReadonlyDb(dbPath, (db) =>
            (db.query('SELECT id FROM threads').all() as Array<{ id: string }>).map(({ id }) => id),
        ),
    );
    const fallbackThreadIds = listFallbackThreadIdsForProject(dbPath, existingThreadIds, projectName);
    const projectThreadIds = withReadonlyDb(dbPath, (db) =>
        (
            db.query(`SELECT id FROM threads WHERE ${PROJECT_CWD_FILTER}`).all(projectName) as Array<{
                id: string;
            }>
        ).map(({ id }) => id),
    );
    const allThreadIds = [...projectThreadIds, ...fallbackThreadIds];
    if (options.deleteSessionFiles) {
        await validateSessionFileDeletionTargets(dbPath, allThreadIds);
    }
    const result = withWritableDb(dbPath, (db) => {
        return deleteThreadIds(db, dbPath, allThreadIds);
    });

    try {
        const sessionIndexResult = await deleteSessionIndexEntriesForThreads(
            dbPath,
            [...result.deletedThreadIds, ...fallbackThreadIds],
            result.deletedRolloutPaths,
            Boolean(options.deleteSessionFiles),
        );

        return {
            projectName,
            ...buildDeleteThreadsResult(sessionIndexResult, options.deleteSessionFiles, result.deletedThreadIds),
        };
    } finally {
        await invalidateCodexUiCaches();
    }
};

export const listScopedThreads = (dbPath: string, projectName: string | null): ThreadRow[] => {
    return mergeFallbackThreadRows(dbPath, readThreads(dbPath, projectName), projectName);
};

export const invalidateCodexUiCaches = async () => {
    await invalidateCacheByPrefix(...CODEX_UI_CACHE_PREFIXES);
};
