import type { Database } from 'bun:sqlite';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CodexSessionIndexReconciliation, DeleteProjectResult, DeleteThreadsResult } from './codex-browser-types';
import {
    assertSafeCodexRolloutPaths,
    chunkValues,
    getExistingCodexHistoryTableNames,
    getExistingTableNames,
    hasRegularFile,
    PROJECT_CWD_FILTER,
    readDbThreadIds,
    resolveCodexDirFromDbPath,
    resolveCodexHistoryDbPath,
    resolveCodexLocalThreadCatalogDbPath,
    resolveCodexRolloutPath,
    SQLITE_DELETE_BATCH_SIZE,
    uniqueValues,
    withReadonlyDb,
    withSqliteTransaction,
    withWritableDb,
} from './codex-database';
import {
    findSessionFileByThreadId,
    getSessionFilesByThreadId,
    isFallbackSubagent,
    readFallbackSessionMeta,
    readSessionIndexEntries,
    stringOrNull,
} from './codex-fallback-index';
import { removeCodexGlobalStateThreadReferencesFromFile } from './codex-global-state';
import { mapWithConcurrency } from './concurrency';
import { getPortablePathBasename } from './portable-path';
import { invalidateCacheByPrefix } from './ui-cache';

type DeleteThreadOptions = {
    deleteSessionFiles?: boolean;
};

type DeleteProjectOptions = {
    deleteSessionFiles?: boolean;
};

type DeleteThreadMutationResult = {
    deletedRolloutPaths: string[];
    deletedThreadIds: string[];
};

const CODEX_UI_CACHE_PREFIXES = ['analytics-', 'thread-', 'thread-preview-'] as const;
const SESSION_FILE_DELETE_CONCURRENCY = 16;
let sessionIndexMutationQueue = Promise.resolve();

type SessionIndexEntry = {
    id: string;
    thread_name?: string;
    updated_at?: string;
};

const parseJsonlObject = <T>(line: string): T | null => {
    try {
        return JSON.parse(line) as T;
    } catch {
        return null;
    }
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

export const invalidateCodexUiCaches = async () => {
    await invalidateCacheByPrefix(...CODEX_UI_CACHE_PREFIXES);
};
