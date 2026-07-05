import { constants, Database } from 'bun:sqlite';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

export { getDefaultOpenCodeDataDir, resolveOpenCodeDbPath };

export const OPENCODE_READONLY_DB_OPEN_FLAGS = constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI;

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

    const db = openOpenCodeReadonlyDb(dbPath);
    try {
        const rows = db
            .query(`${workspaceRowsQuery} ORDER BY lastActiveMs DESC, p.worktree ASC`)
            .all() as WorkspaceRow[];
        return rows.map(toWorkspaceGroup);
    } finally {
        db.close();
    }
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

    const db = openOpenCodeReadonlyDb(dbPath);
    try {
        return readSessionSummaries(db, `s.project_id = ? AND ${MAIN_SESSION_FILTER}`, [projectId]);
    } finally {
        db.close();
    }
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

export const deleteOpenCodeSession = async (
    dbPath: string,
    sessionId: string,
): Promise<DeleteOpenCodeSessionResult> => {
    if (!(await pathExists(dbPath))) {
        return { deletedSessionIds: [] };
    }

    const db = new Database(dbPath);
    try {
        const sessionIds = readOpenCodeSessionTreeIds(db, sessionId);
        if (sessionIds.length === 0) {
            return { deletedSessionIds: [] };
        }

        const placeholders = sessionIds.map(() => '?').join(', ');
        db.transaction(() => {
            db.query(`DELETE FROM part WHERE session_id IN (${placeholders})`).run(...sessionIds);
            db.query(`DELETE FROM message WHERE session_id IN (${placeholders})`).run(...sessionIds);
            db.query(`DELETE FROM session WHERE id IN (${placeholders})`).run(...sessionIds);
        })();

        return { deletedSessionIds: sessionIds };
    } finally {
        db.close();
    }
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

    const db = openOpenCodeReadonlyDb(dbPath);
    try {
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
    } finally {
        db.close();
    }
};
