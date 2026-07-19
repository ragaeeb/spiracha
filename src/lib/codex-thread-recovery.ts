import { Database } from 'bun:sqlite';
import { copyFile, readdir, rm, utimes } from 'node:fs/promises';
import path from 'node:path';
import type { RecoverProjectThreadsResult } from './codex-browser-types';
import { getPortablePathBasename } from './portable-path';
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

const RECOVERY_BACKUP_RETENTION_COUNT = 5;

const backupFile = async (filePath: string, label: string) => {
    const stamp = new Date()
        .toISOString()
        .replaceAll(':', '')
        .replace(/\.\d{3}Z$/, 'Z')
        .replace('T', '-');
    const backupPath = `${filePath}.bak-${label}-${stamp}`;
    await copyFile(filePath, backupPath);
    const directory = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.bak-${label}-`;
    const backups = (await readdir(directory))
        .filter((entry) => entry.startsWith(prefix))
        .sort((left, right) => right.localeCompare(left));
    await Promise.all(
        backups.slice(RECOVERY_BACKUP_RETENTION_COUNT).map((entry) => rm(path.join(directory, entry), { force: true })),
    );
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
    const missingSaved = projectCwds.filter((cwd) => !savedRoots.includes(cwd));
    const missingProjectOrder = projectCwds.filter((cwd) => !projectOrder.includes(cwd));

    if (missingSaved.length === 0 && missingProjectOrder.length === 0) {
        return {
            projectRootsAdded: 0,
            savedRootsAdded: 0,
            state,
        };
    }

    state['electron-saved-workspace-roots'] = [...savedRoots, ...missingSaved];
    state['project-order'] = [...projectOrder, ...missingProjectOrder];

    return {
        projectRootsAdded: missingProjectOrder.length,
        savedRootsAdded: missingSaved.length,
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

const prepareSessionIndexRefresh = async (sessionIndexPath: string, threadIds: string[]) => {
    if (threadIds.length === 0) {
        return { content: null, updated: 0 };
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

        let parsed: { id?: string; updated_at?: string };
        try {
            const value: unknown = JSON.parse(line);
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                rewrittenLines.push(line);
                continue;
            }
            parsed = value as { id?: string; updated_at?: string };
        } catch {
            rewrittenLines.push(line);
            continue;
        }

        if (parsed.id && threadIdSet.has(parsed.id)) {
            parsed.updated_at = now;
            updated += 1;
        }

        rewrittenLines.push(JSON.stringify(parsed));
    }

    return {
        content: `${rewrittenLines.join('\n')}\n`,
        updated,
    };
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
        const threadIds = topLevelThreads.map((thread) => thread.id);
        const rolloutPaths = topLevelThreads.map((thread) => thread.rollout_path);
        const sessionIndexRefresh = await prepareSessionIndexRefresh(sessionIndexPath, threadIds);

        await writeGlobalState(globalStatePath, rootUpdateResult.state);
        const threadDbRowsUpdated = refreshThreadRows(db, threadIds);
        if (sessionIndexRefresh.content !== null) {
            await Bun.write(sessionIndexPath, sessionIndexRefresh.content);
        }
        const rolloutFilesTouched = await touchRolloutFiles(codexDir, rolloutPaths);

        return {
            backups,
            projectName,
            projectRootsAdded: rootUpdateResult.projectRootsAdded,
            resolvedCwds: projectCwds,
            rolloutFilesTouched,
            savedRootsAdded: rootUpdateResult.savedRootsAdded,
            sessionIndexRowsUpdated: sessionIndexRefresh.updated,
            threadDbRowsUpdated,
            topLevelThreadsFound: threadIds.length,
        };
    } finally {
        db.close();
    }
};
