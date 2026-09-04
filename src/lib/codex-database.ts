import { constants, Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CodexDbSchemaProfile, DynamicToolRow, ThreadListEntry } from './codex-browser-types';
import type { SpawnEdgeRow, ThreadRow } from './codex-thread-types';
import { DEFAULT_CODEX_DIR, DEFAULT_DB_PATH } from './codex-thread-types';
import { cleanInlineTitle } from './shared';
import { runWithSqliteRetry } from './sqlite-retry';

export const SQLITE_DELETE_BATCH_SIZE = 400;
// Let the bounded retry policy own lock waiting so a failed transaction is retried on a fresh connection.
const SQLITE_BUSY_TIMEOUT_MS = 0;
const CODEX_READONLY_DB_OPEN_FLAGS = constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI;
export const THREAD_ROW_COLUMNS = `
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
export const CODEX_BROWSE_SCHEMA_PROFILE: CodexDbSchemaProfile = {
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
export const PROJECT_CWD_FILTER = `
    typeof(cwd) = 'text'
    AND (
        RTRIM(cwd, '/\\') = ?1
        OR SUBSTR(RTRIM(cwd, '/\\'), -(LENGTH(?1) + 1)) = '/' || ?1
        OR SUBSTR(RTRIM(cwd, '/\\'), -(LENGTH(?1) + 1)) = '\\' || ?1
    )
`;

export type ProjectAggregateRow = {
    archived_thread_count: number;
    cwd: string;
    last_updated_at_ms: number | null;
    model: string | null;
    thread_count: number;
    total_tokens: number;
};

export type ThreadGoalRow = {
    created_at_ms: number;
    goal_id: string;
    objective: string;
    status: string;
    time_used_seconds: number;
    token_budget: number | null;
    tokens_used: number;
    updated_at_ms: number;
};

const isSqliteCantOpenError = (error: unknown) => {
    return (error as { code?: unknown }).code === 'SQLITE_CANTOPEN';
};

export const uniqueValues = <T>(values: T[]) => [...new Set(values)];

export const compareCodeUnits = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

export const chunkValues = <T>(values: T[], chunkSize: number) => {
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

export const getThreadUpdatedAtMs = (thread: Pick<ThreadRow, 'updated_at' | 'updated_at_ms'>) => {
    return thread.updated_at_ms ?? thread.updated_at * 1000;
};

export const compareThreadsByRecentActivity = (
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

export const parseDynamicToolRow = (row: unknown): DynamicToolRow => {
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

export const decodeThreadGoalRow = (row: unknown): ThreadGoalRow => {
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

export const decodeThreadSpawnEdgeRow = (row: unknown): ThreadSpawnEdge => {
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

export const assertCodexSchemaCompatibility = (db: Database, profile: CodexDbSchemaProfile) => {
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

export const decodeThreadRow = (row: unknown): ThreadRow => {
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

export const withSqliteTransaction = <T>(db: Database, callback: (db: Database) => T): T => {
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

export const getUserVisibleThreadFilter = (db: Database) => {
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

export const withWritableDb = <T>(dbPath: string, callback: (db: Database) => T): T => {
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

export const readThreads = (dbPath: string, projectName: string | null = null): ThreadRow[] => {
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

export const resolveCodexDirFromDbPath = (dbPath: string) => {
    const dbDir = path.dirname(dbPath);
    return path.basename(dbDir) === 'sqlite' ? path.dirname(dbDir) : dbDir;
};

export const resolveCodexLocalThreadCatalogDbPath = (dbPath: string) =>
    path.join(resolveCodexDirFromDbPath(dbPath), 'sqlite', 'codex-dev.db');

export const resolveCodexHistoryDbPath = (dbPath: string) =>
    path.join(resolveCodexDirFromDbPath(dbPath), 'thread_history_1.sqlite');

export const hasRegularFile = (filePath: string) => {
    try {
        return statSync(filePath).isFile();
    } catch {
        return false;
    }
};

export const resolveCodexRolloutPath = (dbPath: string, rolloutPath: string) =>
    path.isAbsolute(rolloutPath) ? rolloutPath : path.join(resolveCodexDirFromDbPath(dbPath), rolloutPath);

export const assertSafeCodexRolloutPaths = async (dbPath: string, rolloutPaths: string[]): Promise<void> => {
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

export type ThreadDisplaySource = Pick<ThreadRow, 'first_user_message' | 'preview' | 'title'> &
    Partial<Pick<ThreadRow, 'agent_nickname' | 'agent_path'>>;

export const normalizeThreadDisplayText = <T extends ThreadDisplaySource>(thread: T): T => {
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

export const getExistingTableNames = (db: Database) => {
    const rows = db.query('SELECT name FROM sqlite_master WHERE type = ?').all('table') as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
};

export const getExistingCodexHistoryTableNames = (db: Database) => {
    const rows = db.query('SELECT name FROM codex_history.sqlite_master WHERE type = ?').all('table') as Array<{
        name: string;
    }>;
    return new Set(rows.map((row) => row.name));
};

export type ThreadSpawnEdge = SpawnEdgeRow;

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

export const getThreadHierarchyById = (dbPath: string, threadIds: string[]) => {
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

export const readDbThreadIds = (db: Database) => {
    const rows = db.query('SELECT id FROM threads').all() as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
};

export const readProjectAggregateRows = (db: Database) => {
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
