import type { DashboardSummary, DashboardThreadSummary, ProjectSummary } from './codex-browser-types';
import type { ProjectAggregateRow } from './codex-database';
import {
    compareThreadsByRecentActivity,
    getExistingTableNames,
    getThreadUpdatedAtMs,
    getUserVisibleThreadFilter,
    normalizeThreadDisplayText,
    readDbThreadIds,
    readProjectAggregateRows,
    withReadonlyDb,
} from './codex-database';
import {
    applyRolloutActivityTimestamps,
    applySessionIndexThreadNames,
    readFallbackThreadRows,
} from './codex-fallback-index';
import type { ThreadRow } from './codex-thread-types';
import { getPortablePathBasename } from './portable-path';

const DASHBOARD_RESULT_LIMIT = 5;

type DashboardThreadCandidate = DashboardThreadSummary & Pick<ThreadRow, 'first_user_message' | 'rollout_path'>;

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
        .map((thread) => ({ project: getPortablePathBasename(thread.cwd), thread: compactDashboardThread(thread) }));
};

const buildProjectSummaryMap = (threads: ThreadRow[]): ProjectSummaryMap => {
    const projectMap: ProjectSummaryMap = new Map();
    for (const thread of threads) {
        const projectName = getPortablePathBasename(thread.cwd);
        if (!projectName) {
            continue;
        }
        const current: ProjectSummaryAccumulator = projectMap.get(projectName) ?? {
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
        const current: ProjectSummaryAccumulator = projectMap.get(projectName) ?? {
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

const mapProjectSummaries = (projectMap: ProjectSummaryMap): ProjectSummary[] =>
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

type DashboardDatabaseTotals = {
    archived_threads: number;
    total_threads: number;
    total_tokens: number;
};

const readDashboardDatabaseData = (dbPath: string) =>
    withReadonlyDb(dbPath, (db) => {
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
                SELECT id, rollout_path, cwd, title, preview, first_user_message,
                       model, tokens_used, updated_at, updated_at_ms
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
            .sort((left, right) => right.threadCount - left.threadCount || left.name.localeCompare(right.name))
            .slice(0, DASHBOARD_RESULT_LIMIT),
        topProjectsByTokens: projects.slice(0, DASHBOARD_RESULT_LIMIT),
        totalProjects: projects.length,
        totalThreads,
        totalTokens:
            Number(database.totals.total_tokens) + fallbackThreads.reduce((sum, thread) => sum + thread.tokens_used, 0),
    };
};
