import { constants, Database } from 'bun:sqlite';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConcurrencyLimiter } from './concurrency';
import {
    getDefaultOpenCodeDataDir,
    type OpenCodeModelInfo,
    type OpenCodePartType,
    type OpenCodeSessionSummary,
    type OpenCodeSessionTranscript,
    type OpenCodeStepTokens,
    type OpenCodeTranscriptMessage,
    type OpenCodeTranscriptPart,
    type OpenCodeWorkspaceGroup,
    resolveOpenCodeDbPath,
} from './opencode-exporter-types';
import { splitOpenCodeThinkTaggedText } from './opencode-think-tags';
import {
    asNumber,
    asObject,
    asString,
    isWorkspacePathQuery,
    type JsonValue,
    workspacePathMatchesQuery,
} from './shared';
import { runWithSqliteRetry } from './sqlite-retry';

export { getDefaultOpenCodeDataDir, resolveOpenCodeDbPath };

export const OPENCODE_READONLY_DB_OPEN_FLAGS = constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI;
const DEFAULT_OPENCODE_DB_CONCURRENCY = 2;

export type DeleteOpenCodeSessionResult = {
    deletedSessionIds: string[];
};

type WorkspaceRow = {
    archivedSessionCount: number;
    lastActiveMs: number;
    messageCount: number;
    name: string | null;
    partCount: number;
    projectId: string;
    sessionCount: number;
    worktree: string;
};

type SessionRow = {
    agent: string | null;
    archivedAtMs: number | null;
    cost: number;
    createdAtMs: number;
    directory: string;
    lastUpdatedAtMs: number;
    messageCount: number;
    model: string | null;
    partCount: number;
    path: string | null;
    permission: string | null;
    projectId: string;
    projectName: string | null;
    renderablePartCount: number;
    sessionId: string;
    slug: string;
    summaryAdditions: number | null;
    summaryDeletions: number | null;
    summaryFiles: number | null;
    textPartCount: number;
    title: string;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    tokensInput: number;
    tokensOutput: number;
    tokensReasoning: number;
    toolPartCount: number;
    worktree: string;
};

type MessageRow = {
    data: string;
    messageId: string;
    timeCreated: number;
    timeUpdated: number;
};

type PartRow = {
    data: string;
    messageId: string;
    partId: string;
    timeCreated: number;
    timeUpdated: number;
};

const MAIN_SESSION_FILTER = 's.parent_id IS NULL';

let nextOpenCodeDbLoadId = 1;
let activeOpenCodeDbLoads = 0;
let queuedOpenCodeDbLoads = 0;

export const resolveOpenCodeDbConcurrency = (value = process.env.SPIRACHA_OPENCODE_DB_CONCURRENCY): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENCODE_DB_CONCURRENCY;
};

const openCodeDbLimiter = createConcurrencyLimiter(resolveOpenCodeDbConcurrency());

const logOpenCodeDb = (event: string, details: Record<string, unknown>) => {
    if (process.env.SPIRACHA_OPENCODE_DB_LOGS !== '0') {
        console.info(`[spiracha:opencode-db] ${event}`, details);
    }
};

const runWithOpenCodeDbLimit = async <T>(operation: string, dbPath: string, action: () => T): Promise<T> => {
    const loadId = nextOpenCodeDbLoadId;
    nextOpenCodeDbLoadId += 1;
    queuedOpenCodeDbLoads += 1;
    const queuedAt = Date.now();

    return openCodeDbLimiter(async () => {
        queuedOpenCodeDbLoads -= 1;
        activeOpenCodeDbLoads += 1;
        const startedAt = Date.now();
        logOpenCodeDb('start', {
            active: activeOpenCodeDbLoads,
            dbPath,
            loadId,
            operation,
            queued: queuedOpenCodeDbLoads,
            waitMs: startedAt - queuedAt,
        });

        try {
            return action();
        } catch (error) {
            logOpenCodeDb('error', {
                active: activeOpenCodeDbLoads,
                dbPath,
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error),
                loadId,
                operation,
                queued: queuedOpenCodeDbLoads,
            });
            throw error;
        } finally {
            activeOpenCodeDbLoads -= 1;
            logOpenCodeDb('finish', {
                active: activeOpenCodeDbLoads,
                dbPath,
                durationMs: Date.now() - startedAt,
                loadId,
                operation,
                queued: queuedOpenCodeDbLoads,
            });
        }
    });
};

const getDefaultOpenCodeDesktopStateDir = (
    env: NodeJS.ProcessEnv = process.env,
    homeDir = os.homedir(),
): string | null => {
    const configured = env.SPIRACHA_OPENCODE_DESKTOP_STATE_DIR?.trim();
    if (configured) {
        return configured;
    }

    return process.platform === 'darwin'
        ? path.join(homeDir, 'Library', 'Application Support', 'ai.opencode.desktop')
        : null;
};

const pathExists = async (target: string): Promise<boolean> => {
    return await stat(target)
        .then(() => true)
        .catch(() => false);
};

export const getOpenCodeReadonlyDbUri = (dbPath: string): string => {
    const url = pathToFileURL(dbPath);
    url.searchParams.set('mode', 'ro');
    return url.href;
};

export const openOpenCodeReadonlyDb = (dbPath: string): Database => {
    return new Database(getOpenCodeReadonlyDbUri(dbPath), OPENCODE_READONLY_DB_OPEN_FLAGS);
};

const withOpenCodeReadonlyDb = <T>(dbPath: string, action: (db: Database) => T): T => {
    return runWithSqliteRetry({
        action: () => {
            const db = openOpenCodeReadonlyDb(dbPath);
            try {
                return action(db);
            } finally {
                db.close();
            }
        },
    });
};

const withOpenCodeWritableDb = <T>(dbPath: string, action: (db: Database) => T): T => {
    return runWithSqliteRetry({
        action: () => {
            const db = new Database(dbPath);
            try {
                return action(db);
            } finally {
                db.close();
            }
        },
    });
};

const parseJsonValue = (value: string | null): JsonValue | string | null => {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value) as JsonValue;
    } catch {
        return value;
    }
};

const parseJsonObject = (value: string): Record<string, JsonValue> => {
    const parsed = parseJsonValue(value);
    return asObject(parsed) ?? {};
};

const parseMutableJsonObject = (value: string): Record<string, unknown> | null => {
    try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
};

const parseMutableJsonArray = (value: string): unknown[] | null => {
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const encodeOpenCodeDirectoryKey = (directory: string): string => {
    return Buffer.from(directory).toString('base64').replace(/=+$/u, '');
};

const cleanLabel = (value: string | null | undefined): string | null => {
    const cleaned = value?.replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned : null;
};

const getWorkspaceLabel = (name: string | null, worktree: string): string => {
    const named = cleanLabel(name);
    if (named) {
        return named;
    }

    if (worktree === '/') {
        return '(global)';
    }

    return path.basename(worktree.replace(/\/+$/u, '')) || worktree;
};

const getWorkspaceKey = (projectId: string): string => `project:${projectId}`;

const getProjectIdFromWorkspaceKey = (workspaceKey: string): string | null => {
    return workspaceKey.startsWith('project:') ? workspaceKey.slice('project:'.length) : null;
};

const parseModelInfo = (value: string | null): OpenCodeModelInfo => {
    const parsed = parseJsonValue(value);
    if (typeof parsed === 'string') {
        return {
            id: parsed,
            providerID: null,
            raw: parsed,
            variant: null,
        };
    }

    const model = asObject(parsed);
    return {
        id: asString(model?.id ?? null),
        providerID: asString(model?.providerID ?? null),
        raw: parsed,
        variant: asString(model?.variant ?? null),
    };
};

const formatModelLabel = (model: OpenCodeModelInfo): string | null => {
    if (typeof model.raw === 'string') {
        return cleanLabel(model.raw);
    }

    const id = cleanLabel(model.id);
    const variant = cleanLabel(model.variant);
    if (!id) {
        return null;
    }

    return variant ? `${id} ${variant}` : id;
};

const toWorkspaceGroup = (row: WorkspaceRow): OpenCodeWorkspaceGroup => {
    const label = getWorkspaceLabel(row.name, row.worktree);
    return {
        archivedSessionCount: row.archivedSessionCount,
        key: getWorkspaceKey(row.projectId),
        label,
        lastActiveMs: row.lastActiveMs,
        messageCount: row.messageCount,
        partCount: row.partCount,
        projectId: row.projectId,
        sessionCount: row.sessionCount,
        uri: pathToFileURL(row.worktree).href,
        worktree: row.worktree,
    };
};

const toSessionSummary = (row: SessionRow): OpenCodeSessionSummary => {
    const label = getWorkspaceLabel(row.projectName, row.worktree);
    const model = parseModelInfo(row.model);
    return {
        agent: row.agent,
        archivedAtMs: row.archivedAtMs,
        cost: row.cost,
        createdAtMs: row.createdAtMs,
        directory: row.directory,
        lastUpdatedAtMs: row.lastUpdatedAtMs,
        messageCount: row.messageCount,
        model,
        modelLabel: formatModelLabel(model),
        partCount: row.partCount,
        path: row.path,
        permission: row.permission,
        projectId: row.projectId,
        renderablePartCount: row.renderablePartCount,
        sessionId: row.sessionId,
        slug: row.slug,
        summaryAdditions: row.summaryAdditions,
        summaryDeletions: row.summaryDeletions,
        summaryFiles: row.summaryFiles,
        textPartCount: row.textPartCount,
        title: cleanLabel(row.title) ?? row.sessionId,
        tokensCacheRead: row.tokensCacheRead,
        tokensCacheWrite: row.tokensCacheWrite,
        tokensInput: row.tokensInput,
        tokensOutput: row.tokensOutput,
        tokensReasoning: row.tokensReasoning,
        toolPartCount: row.toolPartCount,
        totalTokens:
            row.tokensInput + row.tokensOutput + row.tokensReasoning + row.tokensCacheRead + row.tokensCacheWrite,
        workspaceKey: getWorkspaceKey(row.projectId),
        workspaceLabel: label,
        worktree: row.worktree,
    };
};

const workspaceRowsQuery = `
    SELECT
        p.id AS projectId,
        p.name AS name,
        p.worktree AS worktree,
        (
            SELECT COUNT(*)
            FROM session s
            WHERE s.project_id = p.id AND ${MAIN_SESSION_FILTER}
        ) AS sessionCount,
        (
            SELECT COUNT(*)
            FROM session s
            WHERE s.project_id = p.id AND ${MAIN_SESSION_FILTER} AND s.time_archived IS NOT NULL
        ) AS archivedSessionCount,
        (
            SELECT COUNT(*)
            FROM message m
            JOIN session s ON s.id = m.session_id
            WHERE s.project_id = p.id AND ${MAIN_SESSION_FILTER}
        ) AS messageCount,
        (
            SELECT COUNT(*)
            FROM part prt
            JOIN session s ON s.id = prt.session_id
            WHERE s.project_id = p.id AND ${MAIN_SESSION_FILTER}
        ) AS partCount,
        COALESCE((
            SELECT MAX(s.time_updated)
            FROM session s
            WHERE s.project_id = p.id AND ${MAIN_SESSION_FILTER}
        ), p.time_updated) AS lastActiveMs
    FROM project p
`;

const sessionSelectQuery = `
    SELECT
        s.id AS sessionId,
        s.project_id AS projectId,
        p.name AS projectName,
        p.worktree AS worktree,
        s.slug AS slug,
        s.directory AS directory,
        s.title AS title,
        s.permission AS permission,
        s.time_created AS createdAtMs,
        s.time_updated AS lastUpdatedAtMs,
        s.time_archived AS archivedAtMs,
        s.path AS path,
        s.agent AS agent,
        s.model AS model,
        s.cost AS cost,
        s.tokens_input AS tokensInput,
        s.tokens_output AS tokensOutput,
        s.tokens_reasoning AS tokensReasoning,
        s.tokens_cache_read AS tokensCacheRead,
        s.tokens_cache_write AS tokensCacheWrite,
        s.summary_files AS summaryFiles,
        s.summary_additions AS summaryAdditions,
        s.summary_deletions AS summaryDeletions,
        (
            SELECT COUNT(*)
            FROM message m
            WHERE m.session_id = s.id
        ) AS messageCount,
        (
            SELECT COUNT(*)
            FROM part prt
            WHERE prt.session_id = s.id
        ) AS partCount,
        (
            SELECT COUNT(*)
            FROM part prt
            WHERE prt.session_id = s.id AND json_extract(prt.data, '$.type') = 'text'
        ) AS textPartCount,
        (
            SELECT COUNT(*)
            FROM part prt
            WHERE prt.session_id = s.id AND json_extract(prt.data, '$.type') = 'tool'
        ) AS toolPartCount,
        (
            SELECT COUNT(*)
            FROM part prt
            WHERE prt.session_id = s.id
              AND (
                (
                    json_extract(prt.data, '$.type') IN ('text', 'reasoning')
                    AND trim(COALESCE(json_extract(prt.data, '$.text'), '')) <> ''
                )
                OR json_extract(prt.data, '$.type') = 'tool'
              )
        ) AS renderablePartCount
    FROM session s
    JOIN project p ON p.id = s.project_id
`;

export const listOpenCodeWorkspaceGroups = async (
    dbPath = resolveOpenCodeDbPath(),
): Promise<OpenCodeWorkspaceGroup[]> => {
    if (!(await pathExists(dbPath))) {
        return [];
    }

    return runWithOpenCodeDbLimit('list-workspaces', dbPath, () =>
        withOpenCodeReadonlyDb(dbPath, (db) => {
            const rows = db
                .query(`${workspaceRowsQuery} ORDER BY lastActiveMs DESC, p.worktree ASC`)
                .all() as WorkspaceRow[];
            return rows.map(toWorkspaceGroup);
        }),
    );
};

const openCodeWorkspaceMatchesQuery = (workspace: OpenCodeWorkspaceGroup, query: string): boolean => {
    const raw = query.trim();
    if (!raw) {
        return true;
    }

    const lowered = raw.toLowerCase();
    if (
        workspace.key.toLowerCase() === lowered ||
        workspace.projectId.toLowerCase() === lowered ||
        workspace.label.toLowerCase() === lowered
    ) {
        return true;
    }

    if (isWorkspacePathQuery(raw)) {
        return workspacePathMatchesQuery(workspace.worktree, raw);
    }

    return path.basename(workspace.worktree).toLowerCase() === lowered;
};

export const findOpenCodeWorkspaceGroups = (
    groups: OpenCodeWorkspaceGroup[],
    query: string,
): OpenCodeWorkspaceGroup[] => {
    return groups.filter((group) => openCodeWorkspaceMatchesQuery(group, query));
};

const readSessionSummaries = (db: Database, whereSql: string, params: string[]): OpenCodeSessionSummary[] => {
    const rows = db
        .query(`${sessionSelectQuery} WHERE ${whereSql} ORDER BY s.time_updated DESC, s.title ASC`)
        .all(...params) as SessionRow[];
    return rows.map(toSessionSummary);
};

export const listOpenCodeSessionsForGroup = async (
    workspaceKey: string,
    dbPath = resolveOpenCodeDbPath(),
): Promise<OpenCodeSessionSummary[]> => {
    const projectId = getProjectIdFromWorkspaceKey(workspaceKey);
    if (!projectId || !(await pathExists(dbPath))) {
        return [];
    }

    return runWithOpenCodeDbLimit('list-sessions', dbPath, () =>
        withOpenCodeReadonlyDb(dbPath, (db) => {
            return readSessionSummaries(db, `s.project_id = ? AND ${MAIN_SESSION_FILTER}`, [projectId]);
        }),
    );
};

const readOpenCodeSessionSummary = (db: Database, sessionId: string): OpenCodeSessionSummary | null => {
    return readSessionSummaries(db, `s.id = ? AND ${MAIN_SESSION_FILTER}`, [sessionId])[0] ?? null;
};

const readOpenCodeSessionTreeIds = (db: Database, sessionId: string): string[] => {
    const rows = db
        .query(
            `WITH RECURSIVE session_tree(id) AS (
                SELECT id FROM session WHERE id = ?
                UNION ALL
                SELECT child.id
                FROM session child
                JOIN session_tree parent ON child.parent_id = parent.id
            )
            SELECT id FROM session_tree`,
        )
        .all(sessionId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
};

const hasOpenCodeTable = (db: Database, tableName: string): boolean => {
    return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
};

const deleteRowsBySessionId = (db: Database, tableName: string, sessionIds: string[], placeholders: string) => {
    if (hasOpenCodeTable(db, tableName)) {
        db.query(`DELETE FROM ${tableName} WHERE session_id IN (${placeholders})`).run(...sessionIds);
    }
};

const deleteOpenCodeEventRows = (db: Database, sessionIds: string[], placeholders: string) => {
    if (hasOpenCodeTable(db, 'event')) {
        db.query(`DELETE FROM event WHERE aggregate_id IN (${placeholders})`).run(...sessionIds);
    }
    if (hasOpenCodeTable(db, 'event_sequence')) {
        db.query(`DELETE FROM event_sequence WHERE aggregate_id IN (${placeholders})`).run(...sessionIds);
    }
};

const collectEmptyOpenCodeWorktrees = (
    db: Database,
    projects: Array<{ projectId: string; worktree: string }>,
): string[] => {
    const emptyWorktrees: string[] = [];
    for (const project of projects) {
        const remaining = db
            .query('SELECT COUNT(*) AS count FROM session WHERE project_id = ? AND parent_id IS NULL')
            .get(project.projectId) as { count: number };
        if (remaining.count === 0) {
            emptyWorktrees.push(project.worktree);
        }
    }
    return emptyWorktrees;
};

const deleteOpenCodeSessionRows = (
    db: Database,
    sessionIds: string[],
    placeholders: string,
    projectRows: Array<{ projectId: string; worktree: string }>,
): string[] => {
    deleteOpenCodeEventRows(db, sessionIds, placeholders);
    deleteRowsBySessionId(db, 'session_context_epoch', sessionIds, placeholders);
    deleteRowsBySessionId(db, 'session_input', sessionIds, placeholders);
    deleteRowsBySessionId(db, 'session_message', sessionIds, placeholders);
    deleteRowsBySessionId(db, 'session_share', sessionIds, placeholders);
    deleteRowsBySessionId(db, 'todo', sessionIds, placeholders);
    db.query(`DELETE FROM part WHERE session_id IN (${placeholders})`).run(...sessionIds);
    db.query(`DELETE FROM message WHERE session_id IN (${placeholders})`).run(...sessionIds);
    db.query(`DELETE FROM session WHERE id IN (${placeholders})`).run(...sessionIds);
    return collectEmptyOpenCodeWorktrees(db, projectRows);
};

const removeObjectKeysForSessionIds = (target: Record<string, unknown>, sessionIds: Set<string>) => {
    let changed = false;
    for (const key of Object.keys(target)) {
        if (sessionIds.has(key) || [...sessionIds].some((sessionId) => key.includes(`/${sessionId}`))) {
            delete target[key];
            changed = true;
        }
    }
    return changed;
};

const updateJsonStringField = (
    state: Record<string, unknown>,
    key: string,
    update: (value: string) => { changed: boolean; next: unknown },
) => {
    const current = state[key];
    if (typeof current !== 'string') {
        return false;
    }

    const result = update(current);
    if (!result.changed) {
        return false;
    }

    state[key] = JSON.stringify(result.next);
    return true;
};

const cleanOpenCodeServerProjects = (projects: Record<string, unknown>, worktrees: Set<string>): boolean => {
    let changed = false;
    for (const [serverId, entries] of Object.entries(projects)) {
        if (!Array.isArray(entries)) {
            continue;
        }

        const nextEntries = entries.filter((entry) => {
            return !(
                entry &&
                typeof entry === 'object' &&
                worktrees.has(String((entry as Record<string, unknown>).worktree ?? ''))
            );
        });
        if (nextEntries.length !== entries.length) {
            projects[serverId] = nextEntries;
            changed = true;
        }
    }
    return changed;
};

const cleanOpenCodeServerLastProject = (lastProject: Record<string, unknown>, worktrees: Set<string>): boolean => {
    let changed = false;
    for (const [serverId, directory] of Object.entries(lastProject)) {
        if (worktrees.has(String(directory))) {
            delete lastProject[serverId];
            changed = true;
        }
    }
    return changed;
};

const cleanOpenCodeServerState = (value: string, worktrees: Set<string>) => {
    const parsed = parseMutableJsonObject(value);
    const projects = parseMutableJsonObject(JSON.stringify(parsed?.projects ?? null));
    const lastProject = parseMutableJsonObject(JSON.stringify(parsed?.lastProject ?? null));
    if (!parsed) {
        return { changed: false, next: parsed };
    }

    const projectsChanged = projects ? cleanOpenCodeServerProjects(projects, worktrees) : false;
    const lastProjectChanged = lastProject ? cleanOpenCodeServerLastProject(lastProject, worktrees) : false;
    parsed.projects = projects ?? parsed.projects;
    parsed.lastProject = lastProject ?? parsed.lastProject;

    const changed = projectsChanged || lastProjectChanged;
    return changed ? { changed: true, next: parsed } : { changed: false, next: parsed };
};

const cleanOpenCodeDesktopStateObject = (
    state: Record<string, unknown>,
    sessionIds: Set<string>,
    worktrees: Set<string>,
): boolean => {
    let changed = false;
    const encodedWorktrees = new Set([...worktrees].map(encodeOpenCodeDirectoryKey));

    for (const key of Object.keys(state)) {
        if ([...sessionIds].some((sessionId) => key.startsWith(`session:${sessionId}:`))) {
            delete state[key];
            changed = true;
        }
    }

    changed =
        updateJsonStringField(state, 'notification', (value) => {
            const parsed = parseMutableJsonObject(value);
            const list = parsed?.list;
            if (!Array.isArray(list)) {
                return { changed: false, next: parsed };
            }

            const nextList = list.filter((item) => {
                return !(
                    item &&
                    typeof item === 'object' &&
                    (sessionIds.has(String((item as Record<string, unknown>).session ?? '')) ||
                        worktrees.has(String((item as Record<string, unknown>).directory ?? '')))
                );
            });
            if (nextList.length === list.length) {
                return { changed: false, next: parsed };
            }

            return { changed: true, next: { ...parsed, list: nextList } };
        }) || changed;

    changed =
        updateJsonStringField(state, 'layout.page', (value) => {
            const parsed = parseMutableJsonObject(value);
            const lastProjectSession = parseMutableJsonObject(JSON.stringify(parsed?.lastProjectSession ?? null));
            if (!parsed || !lastProjectSession) {
                return { changed: false, next: parsed };
            }

            let nextChanged = false;
            for (const [directory, session] of Object.entries(lastProjectSession)) {
                if (
                    session &&
                    typeof session === 'object' &&
                    (sessionIds.has(String((session as Record<string, unknown>).id ?? '')) ||
                        worktrees.has(directory) ||
                        worktrees.has(String((session as Record<string, unknown>).directory ?? '')))
                ) {
                    delete lastProjectSession[directory];
                    nextChanged = true;
                }
            }

            return nextChanged
                ? { changed: true, next: { ...parsed, lastProjectSession } }
                : { changed: false, next: parsed };
        }) || changed;

    changed = updateJsonStringField(state, 'server', (value) => cleanOpenCodeServerState(value, worktrees)) || changed;

    changed =
        updateJsonStringField(state, 'permission', (value) => {
            const parsed = parseMutableJsonObject(value);
            const autoAccept = parseMutableJsonObject(JSON.stringify(parsed?.autoAccept ?? null));
            if (!parsed || !autoAccept) {
                return { changed: false, next: parsed };
            }

            const nextChanged = removeObjectKeysForSessionIds(autoAccept, sessionIds);
            return nextChanged ? { changed: true, next: { ...parsed, autoAccept } } : { changed: false, next: parsed };
        }) || changed;

    changed =
        updateJsonStringField(state, 'tabs', (value) => {
            const parsed = parseMutableJsonArray(value);
            if (!parsed) {
                return { changed: false, next: parsed };
            }

            const next = parsed.filter((item) => {
                return !(
                    item &&
                    typeof item === 'object' &&
                    (sessionIds.has(String((item as Record<string, unknown>).sessionId ?? '')) ||
                        encodedWorktrees.has(String((item as Record<string, unknown>).dirBase64 ?? '')))
                );
            });
            return next.length === parsed.length ? { changed: false, next: parsed } : { changed: true, next };
        }) || changed;

    changed =
        updateJsonStringField(state, 'workspace:model-selection', (value) => {
            const parsed = parseMutableJsonObject(value);
            const session = parseMutableJsonObject(JSON.stringify(parsed?.session ?? null));
            if (!parsed || !session) {
                return { changed: false, next: parsed };
            }

            const nextChanged = removeObjectKeysForSessionIds(session, sessionIds);
            return nextChanged ? { changed: true, next: { ...parsed, session } } : { changed: false, next: parsed };
        }) || changed;

    changed =
        updateJsonStringField(state, 'workspace:followup', (value) => {
            const parsed = parseMutableJsonObject(value);
            if (!parsed) {
                return { changed: false, next: parsed };
            }

            let nextChanged = false;
            for (const key of ['items', 'failed', 'paused', 'edit']) {
                const child = parseMutableJsonObject(JSON.stringify(parsed[key] ?? null));
                if (child && removeObjectKeysForSessionIds(child, sessionIds)) {
                    parsed[key] = child;
                    nextChanged = true;
                }
            }

            return nextChanged ? { changed: true, next: parsed } : { changed: false, next: parsed };
        }) || changed;

    return changed;
};

export const deleteOpenCodeDesktopSessionState = async (
    sessionIds: string[],
    stateDir = getDefaultOpenCodeDesktopStateDir(),
    worktrees: string[] = [],
): Promise<string[]> => {
    if (!stateDir || (sessionIds.length === 0 && worktrees.length === 0) || !(await pathExists(stateDir))) {
        return [];
    }

    const sessionIdSet = new Set(sessionIds);
    const worktreeSet = new Set(worktrees);
    const changedFiles: string[] = [];
    for (const fileName of await readdir(stateDir)) {
        if (!fileName.endsWith('.dat')) {
            continue;
        }

        const filePath = path.join(stateDir, fileName);
        const state = parseMutableJsonObject(await Bun.file(filePath).text());
        if (!state || !cleanOpenCodeDesktopStateObject(state, sessionIdSet, worktreeSet)) {
            continue;
        }

        await Bun.write(filePath, `${JSON.stringify(state, null, '\t')}\n`);
        changedFiles.push(filePath);
    }

    return changedFiles;
};

export const deleteOpenCodeSession = async (
    dbPath: string,
    sessionId: string,
): Promise<DeleteOpenCodeSessionResult> => {
    if (!(await pathExists(dbPath))) {
        return { deletedSessionIds: [] };
    }

    const result = await runWithOpenCodeDbLimit('delete-session', dbPath, () =>
        withOpenCodeWritableDb(dbPath, (db) => {
            const sessionIds = readOpenCodeSessionTreeIds(db, sessionId);
            if (sessionIds.length === 0) {
                return { deletedSessionIds: [], emptyWorktrees: [] };
            }

            const placeholders = sessionIds.map(() => '?').join(', ');
            const projectRows = db
                .query(
                    `SELECT DISTINCT pr.id AS projectId, pr.worktree
                FROM session s
                JOIN project pr ON pr.id = s.project_id
                WHERE s.id IN (${placeholders})`,
                )
                .all(...sessionIds) as Array<{ projectId: string; worktree: string }>;
            const emptyWorktrees = db.transaction(() =>
                deleteOpenCodeSessionRows(db, sessionIds, placeholders, projectRows),
            )();

            return { deletedSessionIds: sessionIds, emptyWorktrees };
        }),
    );

    await deleteOpenCodeDesktopSessionState(
        result.deletedSessionIds.length > 0 ? result.deletedSessionIds : [sessionId],
        undefined,
        result.emptyWorktrees,
    );
    return { deletedSessionIds: result.deletedSessionIds };
};

const getMessageRole = (raw: Record<string, JsonValue>): string => asString(raw.role ?? null) ?? 'unknown';

const toPartType = (value: JsonValue | undefined): OpenCodePartType => {
    switch (value) {
        case 'reasoning':
        case 'step-finish':
        case 'step-start':
        case 'text':
        case 'tool':
            return value;
        default:
            return 'unknown';
    }
};

const formatJsonLike = (value: JsonValue | undefined): string | null => {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value, null, 2);
};

const parseTimeMs = (raw: Record<string, JsonValue>, key: 'end' | 'start'): number | null => {
    const time = asObject(raw.time ?? null);
    return asNumber(time?.[key] ?? null);
};

const parseToolTimeMs = (raw: Record<string, JsonValue>, key: 'end' | 'start'): number | null => {
    const state = asObject(raw.state ?? null);
    const time = asObject(state?.time ?? null) ?? asObject(raw.time ?? null);
    return asNumber(time?.[key] ?? null);
};

const parseStepTokens = (value: JsonValue | undefined): OpenCodeStepTokens | null => {
    const tokens = asObject(value ?? null);
    if (!tokens) {
        return null;
    }

    const cache = asObject(tokens.cache ?? null);
    return {
        cacheRead: asNumber(cache?.read ?? null) ?? 0,
        cacheWrite: asNumber(cache?.write ?? null) ?? 0,
        input: asNumber(tokens.input ?? null) ?? 0,
        output: asNumber(tokens.output ?? null) ?? 0,
        reasoning: asNumber(tokens.reasoning ?? null) ?? 0,
        total: asNumber(tokens.total ?? null) ?? 0,
    };
};

type BaseOpenCodePart = Omit<OpenCodeTranscriptPart, 'type'> & { type: OpenCodePartType };

const parseTextOpenCodePart = (base: BaseOpenCodePart): OpenCodeTranscriptPart => ({
    ...base,
    endTimeMs: parseTimeMs(base.raw, 'end'),
    startTimeMs: parseTimeMs(base.raw, 'start'),
    text: asString(base.raw.text ?? null) ?? '',
});

const parseToolOpenCodePart = (base: BaseOpenCodePart): OpenCodeTranscriptPart => {
    const state = asObject(base.raw.state ?? null);
    return {
        ...base,
        argumentsText: formatJsonLike(state?.input),
        callId: asString(base.raw.callID ?? null) ?? asString(base.raw.callId ?? null),
        endTimeMs: parseToolTimeMs(base.raw, 'end'),
        outputText: formatJsonLike(state?.output),
        startTimeMs: parseToolTimeMs(base.raw, 'start'),
        status: asString(state?.status ?? null),
        title: asString(state?.title ?? null),
        toolName: asString(base.raw.tool ?? null) ?? 'unknown',
    };
};

const parseStepFinishOpenCodePart = (base: BaseOpenCodePart): OpenCodeTranscriptPart => ({
    ...base,
    reason: asString(base.raw.reason ?? null),
    snapshot: asString(base.raw.snapshot ?? null),
    tokens: parseStepTokens(base.raw.tokens),
});

const parseStepStartOpenCodePart = (base: BaseOpenCodePart): OpenCodeTranscriptPart => ({
    ...base,
    snapshot: asString(base.raw.snapshot ?? null),
});

const parseOpenCodePartByType = (base: BaseOpenCodePart): OpenCodeTranscriptPart => {
    switch (base.type) {
        case 'reasoning':
        case 'text':
            return parseTextOpenCodePart(base);
        case 'tool':
            return parseToolOpenCodePart(base);
        case 'step-finish':
            return parseStepFinishOpenCodePart(base);
        case 'step-start':
            return parseStepStartOpenCodePart(base);
        case 'unknown':
            return base;
    }
};

const parseOpenCodePart = (row: PartRow, role: string): OpenCodeTranscriptPart => {
    const raw = parseJsonObject(row.data);
    return parseOpenCodePartByType({
        createdAtMs: row.timeCreated,
        messageId: row.messageId,
        partId: row.partId,
        raw,
        role,
        type: toPartType(raw.type),
        updatedAtMs: row.timeUpdated,
    });
};

const isRenderablePart = (part: OpenCodeTranscriptPart): boolean => {
    if (part.type === 'text' || part.type === 'reasoning') {
        const { reasoningBlocks, visibleText } = splitOpenCodeThinkTaggedText(part.text ?? '');
        return Boolean(visibleText.trim() || reasoningBlocks.length > 0);
    }

    if (part.type === 'tool') {
        return Boolean(part.toolName || part.outputText?.trim() || part.argumentsText?.trim());
    }

    return false;
};

const readMessages = (db: Database, sessionId: string): OpenCodeTranscriptMessage[] => {
    const messageRows = db
        .query(
            `SELECT id AS messageId, time_created AS timeCreated, time_updated AS timeUpdated, data
             FROM message
             WHERE session_id = ?
             ORDER BY time_created ASC, id ASC`,
        )
        .all(sessionId) as MessageRow[];
    const partRows = db
        .query(
            `SELECT id AS partId, message_id AS messageId, time_created AS timeCreated, time_updated AS timeUpdated, data
             FROM part
             WHERE session_id = ?
             ORDER BY time_created ASC, id ASC`,
        )
        .all(sessionId) as PartRow[];
    const partsByMessageId = new Map<string, PartRow[]>();
    for (const part of partRows) {
        const parts = partsByMessageId.get(part.messageId) ?? [];
        parts.push(part);
        partsByMessageId.set(part.messageId, parts);
    }

    return messageRows.map((message): OpenCodeTranscriptMessage => {
        const raw = parseJsonObject(message.data);
        const role = getMessageRole(raw);
        const parts = (partsByMessageId.get(message.messageId) ?? []).map((part) => parseOpenCodePart(part, role));
        return {
            createdAtMs: message.timeCreated,
            messageId: message.messageId,
            parts,
            raw,
            role,
            updatedAtMs: message.timeUpdated,
        };
    });
};

export const readOpenCodeSessionTranscript = async (
    dbPath: string,
    sessionId: string,
): Promise<OpenCodeSessionTranscript | null> => {
    if (!(await pathExists(dbPath))) {
        return null;
    }

    return runWithOpenCodeDbLimit('read-session', dbPath, () =>
        withOpenCodeReadonlyDb(dbPath, (db) => {
            const session = readOpenCodeSessionSummary(db, sessionId);
            if (!session) {
                return null;
            }

            const messages = readMessages(db, sessionId);
            const partCount = messages.reduce((total, message) => total + message.parts.length, 0);
            const renderablePartCount = messages.reduce(
                (total, message) => total + message.parts.filter(isRenderablePart).length,
                0,
            );

            return {
                messages,
                partCount,
                renderablePartCount,
                session,
            };
        }),
    );
};
