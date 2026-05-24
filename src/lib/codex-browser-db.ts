import { Database } from 'bun:sqlite';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
    DashboardSummary,
    DeleteProjectResult,
    DeleteThreadsResult,
    DynamicToolRow,
    ProjectSummary,
    ThreadBrowseData,
    ThreadListEntry,
} from './codex-browser-types';
import type { ThreadRelations, ThreadRow } from './codex-exporter-types';
import { DEFAULT_CODEX_DIR, DEFAULT_DB_PATH } from './codex-exporter-types';
import { getCachedParsedCodexTranscript, getThreadRolloutLoadState } from './codex-thread-cache';
import { cleanInlineTitle, getPortablePathBasename } from './shared';
import { runWithSqliteRetry } from './sqlite-retry';
import { invalidateCacheByPrefix } from './ui-cache';

type DeleteThreadOptions = {
    deleteSessionFiles?: boolean;
};

type DeleteProjectOptions = {
    deleteSessionFiles?: boolean;
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

const withReadonlyDb = <T>(dbPath: string, callback: (db: Database) => T): T => {
    return runWithSqliteRetry({
        action: () => {
            const db = new Database(dbPath, { readonly: true });
            db.exec('PRAGMA busy_timeout = 5000');
            try {
                return callback(db);
            } finally {
                db.close();
            }
        },
    });
};

const withWritableDb = <T>(dbPath: string, callback: (db: Database) => T): T => {
    const db = runWithSqliteRetry({
        action: () => {
            const connection = new Database(dbPath);
            connection.exec('PRAGMA busy_timeout = 5000');
            return connection;
        },
    });
    try {
        return callback(db);
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
            const db = runWithSqliteRetry({
                action: () => {
                    const connection = new Database(candidate, { readonly: true });
                    connection.exec('PRAGMA busy_timeout = 1500');
                    return connection;
                },
            });
            db.close();
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

    const placeholders = threadIds.map(() => '?').join(', ');
    return db.query(`SELECT id, rollout_path FROM threads WHERE id IN (${placeholders})`).all(...threadIds) as Array<{
        id: string;
        rollout_path: string;
    }>;
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
        const placeholders = ids.map(() => '?').join(', ');

        // Codex schema differs across versions, so only touch dependent tables that actually exist.
        if (existingTableNames.has('thread_dynamic_tools')) {
            db.query(`DELETE FROM thread_dynamic_tools WHERE thread_id IN (${placeholders})`).run(...ids);
        }

        if (existingTableNames.has('thread_goals')) {
            db.query(`DELETE FROM thread_goals WHERE thread_id IN (${placeholders})`).run(...ids);
        }

        if (existingTableNames.has('stage1_outputs')) {
            db.query(`DELETE FROM stage1_outputs WHERE thread_id IN (${placeholders})`).run(...ids);
        }

        if (existingTableNames.has('thread_spawn_edges')) {
            db.query(
                `DELETE FROM thread_spawn_edges WHERE parent_thread_id IN (${placeholders}) OR child_thread_id IN (${placeholders})`,
            ).run(...ids, ...ids);
        }

        db.query(`DELETE FROM threads WHERE id IN (${placeholders})`).run(...ids);
    });

    deleteMany(existingIds);

    return {
        deletedSessionFiles: threadTargets.map((target) => target.rollout_path),
        deletedThreadIds: existingIds,
    };
};

const deleteThreadSessionFiles = async (sessionFiles: string[]) => {
    const uniqueSessionFiles = [...new Set(sessionFiles)];
    await Promise.all(uniqueSessionFiles.map((sessionFile) => rm(sessionFile, { force: true })));
    return uniqueSessionFiles;
};

export const listCodexProjects = (dbPath: string): ProjectSummary[] => {
    return mapProjectSummaries(buildProjectSummaryMap(readAllThreads(dbPath)));
};

type ListProjectThreadsOptions = {
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
    const threads = filterThreadsByProject(readAllThreads(dbPath), projectName);
    const entries = await Promise.all(
        threads.map(async (thread): Promise<ThreadListEntry> => {
            const rollout = await getThreadRolloutLoadState(thread.rollout_path, options.largeTranscriptThresholdBytes);

            if (rollout.shouldDeferTranscriptLoad) {
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
        }),
    );

    return entries.sort((left, right) => toTimestampMs(right.thread) - toTimestampMs(left.thread));
};

export const getThreadBrowseData = (dbPath: string, threadId: string): ThreadBrowseData => {
    return withReadonlyDb(dbPath, (db) => {
        const existingTableNames = getExistingTableNames(db);
        const thread = db.query('SELECT * FROM threads WHERE id = ? LIMIT 1').get(threadId) as ThreadRow | null;
        if (!thread) {
            throw new Error(`Thread not found: ${threadId}`);
        }

        const dynamicTools = existingTableNames.has('thread_dynamic_tools')
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
    const threads = readAllThreads(dbPath);
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
        recentThreads: threads.slice(0, 5),
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
    const result = withWritableDb(dbPath, (db) => {
        return deleteThreadIds(db, [threadId]);
    });

    try {
        if (options.deleteSessionFiles) {
            return {
                ...result,
                deletedSessionFiles: await deleteThreadSessionFiles(result.deletedSessionFiles),
            };
        }

        return {
            ...result,
            deletedSessionFiles: [],
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
    const result = withWritableDb(dbPath, (db) => {
        return deleteThreadIds(db, threadIds);
    });

    try {
        if (options.deleteSessionFiles) {
            return {
                ...result,
                deletedSessionFiles: await deleteThreadSessionFiles(result.deletedSessionFiles),
            };
        }

        return {
            ...result,
            deletedSessionFiles: [],
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
        if (options.deleteSessionFiles) {
            return {
                ...result,
                deletedSessionFiles: await deleteThreadSessionFiles(result.deletedSessionFiles),
            };
        }

        return {
            ...result,
            deletedSessionFiles: [],
        };
    } finally {
        await invalidateCodexUiCaches();
    }
};

export const listScopedThreads = (dbPath: string, projectName: string | null): ThreadRow[] => {
    return filterThreadsByProject(readAllThreads(dbPath), projectName);
};

export const invalidateCodexUiCaches = async () => {
    await invalidateCacheByPrefix('analytics-', 'thread-');
};
