import { Database } from 'bun:sqlite';
import { copyFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import type { RecoverProjectThreadsResult } from './codex-browser-types';
import { getPortablePathBasename } from './shared';
import { runWithSqliteRetry } from './sqlite-retry';

type RecoveryThreadRow = {
    cwd: string;
    id: string;
    rollout_path: string;
    thread_source: string | null;
};

type GlobalState = {
    'active-workspace-roots'?: string[];
    'electron-saved-workspace-roots'?: string[];
    'project-order'?: string[];
};

const backupFile = async (filePath: string, label: string) => {
    const stamp = new Date()
        .toISOString()
        .replaceAll(':', '')
        .replace(/\.\d{3}Z$/, 'Z')
        .replace('T', '-');
    const backupPath = `${filePath}.bak-${label}-${stamp}`;
    await copyFile(filePath, backupPath);
    return backupPath;
};

const resolveCodexDirFromDbPath = (dbPath: string) => {
    const dbDir = path.dirname(dbPath);
    return path.basename(dbDir) === 'sqlite' ? path.dirname(dbDir) : dbDir;
};

const assertRequiredStatePath = async (filePath: string) => {
    if (!(await Bun.file(filePath).exists())) {
        throw new Error(`Required Codex state file not found: ${filePath}`);
    }
};

const readGlobalState = async (globalStatePath: string) => {
    return (await Bun.file(globalStatePath).json()) as GlobalState;
};

const writeGlobalState = async (globalStatePath: string, state: GlobalState) => {
    await Bun.write(globalStatePath, JSON.stringify(state));
};

const updateGlobalRoots = (state: GlobalState, projectCwds: string[]) => {
    const savedRoots = state['electron-saved-workspace-roots'] ?? [];
    const projectOrder = state['project-order'] ?? [];
    const activeRoots = state['active-workspace-roots'] ?? [];
    const knownRoots = new Set([...savedRoots, ...projectOrder, ...activeRoots]);
    const missingRoots = projectCwds.filter((cwd) => !knownRoots.has(cwd));

    if (missingRoots.length === 0) {
        return {
            projectRootsAdded: 0,
            savedRootsAdded: 0,
            state,
        };
    }

    state['electron-saved-workspace-roots'] = [...savedRoots, ...missingRoots];
    state['project-order'] = [...projectOrder, ...missingRoots.filter((cwd) => !projectOrder.includes(cwd))];

    return {
        projectRootsAdded: missingRoots.length,
        savedRootsAdded: missingRoots.length,
        state,
    };
};

const getProjectTopLevelThreads = (db: Database, projectName: string): RecoveryThreadRow[] => {
    const threads = db
        .query('SELECT id, cwd, rollout_path, thread_source FROM threads WHERE archived = 0')
        .all() as RecoveryThreadRow[];
    return threads.filter((thread) => {
        return getPortablePathBasename(thread.cwd) === projectName && thread.thread_source !== 'subagent';
    });
};

const refreshThreadRows = (db: Database, threadIds: string[]) => {
    if (threadIds.length === 0) {
        return 0;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();
    const placeholders = threadIds.map(() => '?').join(', ');
    const statement = db.prepare(`
        UPDATE threads
        SET updated_at = ?1,
            updated_at_ms = ?2,
            has_user_event = 1
        WHERE id IN (${placeholders})
    `);
    const result = statement.run(nowSeconds, nowMs, ...threadIds);
    return Number(result.changes);
};

const refreshSessionIndex = async (sessionIndexPath: string, threadIds: string[]) => {
    if (threadIds.length === 0) {
        return 0;
    }

    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const threadIdSet = new Set(threadIds);
    const lines = (await Bun.file(sessionIndexPath).text()).split('\n');
    let updated = 0;
    const rewrittenLines: string[] = [];

    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }

        const parsed = JSON.parse(line) as { id?: string; updated_at?: string };
        if (parsed.id && threadIdSet.has(parsed.id)) {
            parsed.updated_at = now;
            updated += 1;
        }

        rewrittenLines.push(JSON.stringify(parsed));
    }

    await Bun.write(sessionIndexPath, `${rewrittenLines.join('\n')}\n`);
    return updated;
};

const touchRolloutFiles = async (codexDir: string, rolloutPaths: string[]) => {
    const now = new Date();
    let touched = 0;

    for (const rolloutPath of rolloutPaths) {
        const absolutePath = path.isAbsolute(rolloutPath) ? rolloutPath : path.join(codexDir, rolloutPath);
        if (!(await Bun.file(absolutePath).exists())) {
            continue;
        }

        await utimes(absolutePath, now, now);
        touched += 1;
    }

    return touched;
};

export const recoverCodexProjectThreads = async (
    dbPath: string,
    projectName: string,
): Promise<RecoverProjectThreadsResult> => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const globalStatePath = path.join(codexDir, '.codex-global-state.json');
    const sessionIndexPath = path.join(codexDir, 'session_index.jsonl');

    await assertRequiredStatePath(dbPath);
    await assertRequiredStatePath(globalStatePath);
    await assertRequiredStatePath(sessionIndexPath);

    const backups = {
        globalState: await backupFile(globalStatePath, 'recover-project-roots'),
        sessionIndex: await backupFile(sessionIndexPath, 'recover-project-session-index'),
        stateDb: await backupFile(dbPath, 'recover-project-threads'),
    };

    const globalState = await readGlobalState(globalStatePath);
    const db = runWithSqliteRetry({
        action: () => {
            const opened = new Database(dbPath);
            opened.exec('PRAGMA busy_timeout = 5000');
            return opened;
        },
    });

    try {
        const topLevelThreads = getProjectTopLevelThreads(db, projectName);
        const projectCwds = [...new Set(topLevelThreads.map((thread) => thread.cwd))];
        const rootUpdateResult = updateGlobalRoots(globalState, projectCwds);
        await writeGlobalState(globalStatePath, rootUpdateResult.state);

        const threadIds = topLevelThreads.map((thread) => thread.id);
        const rolloutPaths = topLevelThreads.map((thread) => thread.rollout_path);
        const threadDbRowsUpdated = refreshThreadRows(db, threadIds);
        const sessionIndexRowsUpdated = await refreshSessionIndex(sessionIndexPath, threadIds);
        const rolloutFilesTouched = await touchRolloutFiles(codexDir, rolloutPaths);

        return {
            backups,
            projectName,
            projectRootsAdded: rootUpdateResult.projectRootsAdded,
            resolvedCwds: projectCwds,
            rolloutFilesTouched,
            savedRootsAdded: rootUpdateResult.savedRootsAdded,
            sessionIndexRowsUpdated,
            threadDbRowsUpdated,
            topLevelThreadsFound: threadIds.length,
        };
    } finally {
        db.close();
    }
};
