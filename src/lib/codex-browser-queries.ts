import type { Database } from 'bun:sqlite';
import type {
    CodexThreadBrowseBatchResult,
    DynamicToolRow,
    ProjectSummary,
    ThreadBrowseData,
    ThreadListEntry,
} from './codex-browser-types';
import {
    assertCodexSchemaCompatibility,
    CODEX_BROWSE_SCHEMA_PROFILE,
    CodexDbCompatibilityError,
    CodexThreadNotFoundError,
    chunkValues,
    compareThreadsByRecentActivity,
    decodeThreadGoalRow,
    decodeThreadRow,
    decodeThreadSpawnEdgeRow,
    getThreadHierarchyById,
    getUserVisibleThreadFilter,
    normalizeThreadDisplayText,
    parseDynamicToolRow,
    readDbThreadIds,
    readProjectAggregateRows,
    readThreads,
    resolveCodexRolloutPath,
    THREAD_ROW_COLUMNS,
    uniqueValues,
    withReadonlyDb,
    withSqliteTransaction,
} from './codex-database';
import {
    applyRolloutActivityTimestamps,
    applySessionIndexThreadNames,
    listFallbackThreadsForPath,
    mergeFallbackThreadRows,
    parseFallbackDynamicTools,
    readBrowseFilesystemData,
    readFallbackSessionMeta,
    readFallbackThreadRowById,
    readFallbackThreadRows,
} from './codex-fallback-index';
import {
    getCachedCodexTranscriptModelNames,
    getCachedCodexTranscriptStats,
    getThreadRolloutLoadState,
} from './codex-thread-cache';
import type { ThreadRelations, ThreadRow } from './codex-thread-types';
import { mapWithConcurrency } from './concurrency';
import { normalizeConversationPath } from './conversation-data/path-match';
import { getPortablePathBasename } from './portable-path';

const SQLITE_DELETE_BATCH_SIZE = 400;
const THREAD_LIST_IO_CONCURRENCY = 8;
const PATH_CWD_FILTER = `
    typeof(cwd) = 'text'
    AND (
        RTRIM(cwd, '/\\') = RTRIM(?1, '/\\')
        OR SUBSTR(RTRIM(cwd, '/\\'), 1, LENGTH(RTRIM(?1, '/\\')) + 1) = RTRIM(?1, '/\\') || '/'
        OR SUBSTR(RTRIM(cwd, '/\\'), 1, LENGTH(RTRIM(?1, '/\\')) + 1) = RTRIM(?1, '/\\') || '\\'
    )
`;

type CodexPathThreadListOptions = {
    updatedAfterMs?: number;
    updatedBeforeMs?: number;
};

const getThreadTimePredicate = (options: CodexPathThreadListOptions) => {
    const predicates: string[] = [];
    const params: number[] = [];
    if (options.updatedAfterMs !== undefined) {
        predicates.push('COALESCE(updated_at_ms, updated_at * 1000) >= ?');
        params.push(options.updatedAfterMs);
    }
    if (options.updatedBeforeMs !== undefined) {
        predicates.push('COALESCE(updated_at_ms, updated_at * 1000) <= ?');
        params.push(options.updatedBeforeMs);
    }
    return { params, sql: predicates.length > 0 ? ` AND ${predicates.join(' AND ')}` : '' };
};

const readThreadsForPath = (
    dbPath: string,
    cwd: string,
    options: CodexPathThreadListOptions,
): { existingThreadIds: Set<string>; threads: ThreadRow[] } => {
    const time = getThreadTimePredicate(options);
    return withReadonlyDb(dbPath, (db) => {
        const filters = [getUserVisibleThreadFilter(db), PATH_CWD_FILTER, ...(time.sql ? [time.sql.slice(5)] : [])];
        return {
            existingThreadIds: readDbThreadIds(db),
            threads: db
                .query(
                    `SELECT ${THREAD_ROW_COLUMNS}
                     FROM threads
                     WHERE ${filters.join(' AND ')}
                     ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC`,
                )
                .all(cwd, ...time.params) as ThreadRow[],
        };
    });
};

export const listCodexThreadsForPath = async (
    dbPath: string,
    cwd: string,
    options: CodexPathThreadListOptions = {},
): Promise<ThreadRow[]> => {
    const normalizedCwd = await normalizeConversationPath(cwd);
    const databaseData = readThreadsForPath(dbPath, normalizedCwd, options);
    const fallbackThreads = await listFallbackThreadsForPath(
        dbPath,
        databaseData.existingThreadIds,
        normalizedCwd,
        options,
    );
    return [...databaseData.threads, ...fallbackThreads].sort(compareThreadsByRecentActivity);
};

export const listScopedThreads = (dbPath: string, projectName: string | null): ThreadRow[] => {
    return mergeFallbackThreadRows(dbPath, readThreads(dbPath, projectName), projectName);
};

const readProjectSummaryDatabaseData = (dbPath: string) => {
    return withReadonlyDb(dbPath, (db) => ({
        existingThreadIds: readDbThreadIds(db),
        projectAggregates: readProjectAggregateRows(db),
    }));
};

type ProjectAggregateRow = {
    archived_thread_count: number;
    cwd: string;
    last_updated_at_ms: number | null;
    model: string | null;
    thread_count: number;
    total_tokens: number;
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

const buildProjectSummaryMap = (threads: ThreadRow[]) => {
    const projectMap = new Map<string, ProjectSummaryAccumulator>();
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
        current.lastUpdatedAtMs = Math.max(
            current.lastUpdatedAtMs ?? 0,
            thread.updated_at_ms ?? thread.updated_at * 1000,
        );
        if (thread.model) {
            current.modelNames.add(thread.model);
        }
        current.threadCount += 1;
        current.totalTokens += thread.tokens_used;
        projectMap.set(projectName, current);
    }
    return projectMap;
};

const mergeProjectAggregateRows = (projectMap: Map<string, ProjectSummaryAccumulator>, rows: ProjectAggregateRow[]) => {
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

const mapProjectSummaries = (projectMap: Map<string, ProjectSummaryAccumulator>): ProjectSummary[] =>
    [...projectMap.values()]
        .map((project) => ({
            archivedThreadCount: project.archivedThreadCount,
            cwdPaths: [...project.cwdPaths].sort(),
            lastUpdatedAtMs: project.lastUpdatedAtMs,
            modelNames: [...project.modelNames].sort(),
            name: project.name,
            threadCount: project.threadCount,
            totalTokens: project.totalTokens,
        }))
        .sort((left, right) => right.totalTokens - left.totalTokens || left.name.localeCompare(right.name));

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
                stats: { deferred: false, execCommandCount: 0, toolCallCount: 0, webSearchEventCount: 0 },
                thread: normalizeThreadDisplayText(thread),
            };
        }
        if (rollout.shouldDeferTranscriptLoad || options.includeTranscriptStats === false) {
            return {
                hierarchy,
                modelNames,
                project: projectName,
                rolloutSizeBytes: rollout.fileSizeBytes,
                stats: { deferred: true, execCommandCount: 0, toolCallCount: 0, webSearchEventCount: 0 },
                thread: normalizeThreadDisplayText(thread),
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
            thread: normalizeThreadDisplayText(thread),
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

type ThreadSpawnEdge = {
    parent_thread_id: string;
    child_thread_id: string;
    status: string;
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
        const edge = decodeThreadSpawnEdgeRow(row) as ThreadSpawnEdge;
        const edgeId = `${edge.parent_thread_id}\u0000${edge.child_thread_id}\u0000${edge.status}`;
        if (seenEdgeIds.has(edgeId)) {
            continue;
        }
        seenEdgeIds.add(edgeId);
        relationsByThreadId.get(edge.parent_thread_id)?.childEdges.push(edge);
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

export const getThreadRelationsBatch = (dbPath: string, threadIds: string[]): Map<string, ThreadRelations> => {
    const databaseData = readThreadBrowseDatabaseData(dbPath, threadIds);
    return new Map(
        [...new Set(threadIds)].map((threadId) => [
            threadId,
            databaseData.relationsByThreadId.get(threadId) ?? { childEdges: [], parentThreadId: null },
        ]),
    );
};

const buildThreadBrowseData = (
    dbPath: string,
    thread: ThreadRow,
    source: 'database' | 'fallback',
    databaseData: ThreadBrowseDatabaseData | null,
    filesystemData?: ReturnType<typeof readBrowseFilesystemData>,
): ThreadBrowseData => {
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
        return { data: null, source: 'missing', status: 'missing', threadId };
    });
};

export const getThreadBrowseData = (dbPath: string, threadId: string): ThreadBrowseData => {
    const result = getThreadBrowseDataBatch(dbPath, [threadId])[0]!;
    if (result.status === 'missing') {
        throw new CodexThreadNotFoundError(threadId);
    }
    return result.data;
};
