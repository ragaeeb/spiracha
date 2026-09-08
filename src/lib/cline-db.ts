import { Database } from 'bun:sqlite';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
    ClineIndexCleanupResult,
    ClineTaskSummary,
    ClineTaskTranscript,
    ClineTranscriptMessage,
    ClineWorkspaceGroup,
    DeleteClineTaskResult,
} from './cline-exporter-types';
import { isSafeClineSessionId, resolveClineDataDir } from './cline-exporter-types';
import { parseClineSessionMessages, timestampFromJson } from './cline-transcript-parser';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import { getPortablePathBasename } from './portable-path';
import { readDirectoryEntriesIfExists } from './shared';
import { asBoolean, asNumber, asObject, asString, cleanInlineTitle, type JsonValue } from './shared-text';

export { getDefaultClineDataDir, resolveClineDataDir } from './cline-exporter-types';

const WORKSPACE_KEY_PREFIX = 'workspace:';
const READ_CONCURRENCY = 8;
const clineDeleteLimiter = createConcurrencyLimiter(1);

type ReadTranscriptOptions = { includeRawPayloads?: boolean };

type ClineSessionEntry = {
    cacheReads: number | null;
    cacheWrites: number | null;
    cwd: string;
    id: string;
    isFavorited: boolean;
    messagesPath: string;
    modelId: string | null;
    sessionDir: string;
    title: string;
    tokensIn: number | null;
    tokensOut: number | null;
    totalCost: number | null;
    updatedAtMs: number | null;
    workspaceSource: 'metadata' | 'session_directory';
};

type ParsedStats = {
    assistantMessageCount: number;
    messageCount: number;
    reasoningCount: number;
    toolCallCount: number;
    toolResultCount: number;
    userMessageCount: number;
};

type ClineSessionHeader = {
    cwd: string | null;
    metadata: Record<string, JsonValue> | null;
    raw: Record<string, JsonValue>;
    sessionId: string;
    workspaceSource: 'metadata' | 'session_directory';
};

export type ClineTranscriptCache = {
    dataDir: string;
    transcripts?: ClineTaskTranscript[];
};

export const createClineTranscriptCache = (dataDir: string): ClineTranscriptCache => ({ dataDir });

const getWorkspaceKey = (worktree: string) => `${WORKSPACE_KEY_PREFIX}${encodeURIComponent(worktree)}`;

const getWorktreeFromWorkspaceKey = (workspaceKey: string): string | null => {
    if (!workspaceKey.startsWith(WORKSPACE_KEY_PREFIX)) {
        return null;
    }
    try {
        return decodeURIComponent(workspaceKey.slice(WORKSPACE_KEY_PREFIX.length));
    } catch {
        return null;
    }
};

const readJson = async (filePath: string): Promise<JsonValue | null> => {
    return (await Bun.file(filePath)
        .json()
        .catch(() => null)) as JsonValue | null;
};

const parseSessionHeader = (value: JsonValue | null, directoryName: string): ClineSessionHeader | null => {
    const raw = asObject(value);
    if (!raw) {
        return null;
    }
    const sessionId = asString(raw.session_id ?? null)?.trim() || directoryName;
    const cwd = asString(raw.workspace_root ?? raw.cwd ?? null)?.trim() || null;
    if (sessionId !== directoryName) {
        return null;
    }
    if (!isSafeClineSessionId(sessionId)) {
        return null;
    }
    return {
        cwd,
        metadata: asObject(raw.metadata ?? null),
        raw,
        sessionId,
        workspaceSource: cwd ? 'metadata' : 'session_directory',
    };
};

const metadataValue = (metadata: Record<string, JsonValue> | null, key: string): JsonValue | null =>
    metadata?.[key] ?? null;

const parseSessionEntry = (
    value: JsonValue | null,
    dataDir: string,
    directoryName: string,
): ClineSessionEntry | null => {
    const header = parseSessionHeader(value, directoryName);
    if (!header) {
        return null;
    }
    const sessionDir = path.join(dataDir, 'sessions', directoryName);
    const { metadata, raw, sessionId } = header;
    const cwd = header.cwd ?? sessionDir;
    return {
        cacheReads: asNumber(metadataValue(metadata, 'cacheReads')),
        cacheWrites: asNumber(metadataValue(metadata, 'cacheWrites')),
        cwd,
        id: sessionId,
        isFavorited: asBoolean(metadataValue(metadata, 'isFavorited')),
        messagesPath: path.join(sessionDir, `${directoryName}.messages.json`),
        modelId: asString(metadataValue(metadata, 'modelId')) ?? asString(raw.model ?? null),
        sessionDir,
        title:
            cleanInlineTitle(asString(metadataValue(metadata, 'title')) ?? asString(raw.prompt ?? null) ?? '') ||
            sessionId,
        tokensIn: asNumber(metadataValue(metadata, 'tokensIn')),
        tokensOut: asNumber(metadataValue(metadata, 'tokensOut')),
        totalCost: asNumber(metadataValue(metadata, 'totalCost')),
        updatedAtMs:
            timestampFromJson(raw.ended_at ?? null) ??
            timestampFromJson(raw.updated_at ?? null) ??
            timestampFromJson(raw.started_at ?? null),
        workspaceSource: header.workspaceSource,
    };
};

const listClineSessionEntries = async (dataDir: string): Promise<ClineSessionEntry[]> => {
    const sessionDirectories = (await readDirectoryEntriesIfExists(path.join(dataDir, 'sessions'))).filter(
        (entry) => entry.isDirectory() && isSafeClineSessionId(entry.name),
    );
    const entries = await mapWithConcurrency(sessionDirectories, READ_CONCURRENCY, async (directory) =>
        parseSessionEntry(
            await readJson(path.join(dataDir, 'sessions', directory.name, `${directory.name}.json`)),
            dataDir,
            directory.name,
        ),
    );
    return entries.flatMap((entry) => entry ?? []);
};

const deleteClineSessionIndex = async (dataDir: string, sessionId: string): Promise<ClineIndexCleanupResult> => {
    const databasePath = path.join(dataDir, 'db', 'sessions.db');
    if (!(await Bun.file(databasePath).exists())) {
        return { status: 'not_found' };
    }
    try {
        const database = new Database(databasePath, { create: false, readwrite: true });
        try {
            return database.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0
                ? { status: 'deleted' }
                : { status: 'not_found' };
        } finally {
            database.close();
        }
    } catch (error) {
        return { message: error instanceof Error ? error.message : String(error), status: 'failed' };
    }
};

const getStats = (messages: ClineTranscriptMessage[]): ParsedStats => ({
    assistantMessageCount: messages.filter(
        (message) => message.role === 'assistant' && ['commentary', 'final_answer'].includes(message.phase),
    ).length,
    messageCount: messages.filter(
        (message) =>
            message.role === 'user' ||
            (message.role === 'assistant' && !['reasoning', 'tool_call'].includes(message.phase)),
    ).length,
    reasoningCount: messages.filter((message) => message.phase === 'reasoning').length,
    toolCallCount: messages.filter((message) => message.phase === 'tool_call').length,
    toolResultCount: messages.filter((message) => message.phase === 'tool_output').length,
    userMessageCount: messages.filter((message) => message.role === 'user').length,
});

const readClineTranscriptFromEntry = async (
    entry: ClineSessionEntry,
    options: ReadTranscriptOptions = {},
): Promise<ClineTaskTranscript | null> => {
    const includeRawPayloads = options.includeRawPayloads ?? true;
    const messages = parseClineSessionMessages(
        (await readJson(entry.messagesPath)) ?? { messages: [] },
        entry.cwd,
        entry.id,
        includeRawPayloads,
    );
    const stats = getStats(messages);
    const createdAtMs = messages.reduce<number | null>((earliest, message) => {
        if (message.createdAtMs === null) {
            return earliest;
        }
        return earliest === null ? message.createdAtMs : Math.min(earliest, message.createdAtMs);
    }, null);
    const task: ClineTaskSummary = {
        ...stats,
        cacheReads: entry.cacheReads,
        cacheWrites: entry.cacheWrites,
        createdAtMs,
        isFavorited: entry.isFavorited,
        lastActiveAtMs: entry.updatedAtMs,
        messagesPath: entry.messagesPath,
        modelId: entry.modelId,
        renderablePartCount: messages.length,
        sessionDir: entry.sessionDir,
        taskId: entry.id,
        title: entry.title,
        tokensIn: entry.tokensIn,
        tokensOut: entry.tokensOut,
        totalCost: entry.totalCost,
        ulid: null,
        workspaceKey: getWorkspaceKey(entry.cwd),
        workspaceLabel: getPortablePathBasename(entry.cwd) || entry.cwd,
        workspaceSource: entry.workspaceSource,
        worktree: entry.cwd,
    };
    return {
        messages,
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
        renderablePartCount: messages.length,
        task,
    };
};

const listClineTranscripts = async (
    dataDir: string,
    options: ReadTranscriptOptions = {},
    cache?: ClineTranscriptCache,
) => {
    if (!options.includeRawPayloads && cache?.dataDir === dataDir && cache.transcripts) {
        return cache.transcripts;
    }
    const entries = await listClineSessionEntries(dataDir);
    const transcripts = await mapWithConcurrency(entries, READ_CONCURRENCY, (entry) =>
        readClineTranscriptFromEntry(entry, options),
    );
    const result = transcripts.flatMap((transcript) => transcript ?? []);
    if (!options.includeRawPayloads && cache?.dataDir === dataDir) {
        cache.transcripts = result;
    }
    return result;
};

export const listClineWorkspaceGroups = async (
    dataDir = resolveClineDataDir(),
    cache?: ClineTranscriptCache,
): Promise<ClineWorkspaceGroup[]> => {
    const transcripts = await listClineTranscripts(dataDir, { includeRawPayloads: false }, cache);
    const byWorkspace = new Map<string, ClineTaskSummary[]>();
    for (const { task } of transcripts) {
        byWorkspace.set(task.worktree, [...(byWorkspace.get(task.worktree) ?? []), task]);
    }
    return [...byWorkspace.entries()]
        .map(([worktree, tasks]) => ({
            assistantMessageCount: tasks.reduce((sum, task) => sum + task.assistantMessageCount, 0),
            key: getWorkspaceKey(worktree),
            label: getPortablePathBasename(worktree) || worktree,
            lastActiveAtMs: tasks.reduce<number | null>(
                (latest, task) => (task.lastActiveAtMs === null ? latest : Math.max(latest ?? 0, task.lastActiveAtMs)),
                null,
            ),
            messageCount: tasks.reduce((sum, task) => sum + task.messageCount, 0),
            reasoningCount: tasks.reduce((sum, task) => sum + task.reasoningCount, 0),
            taskCount: tasks.length,
            toolCallCount: tasks.reduce((sum, task) => sum + task.toolCallCount, 0),
            toolResultCount: tasks.reduce((sum, task) => sum + task.toolResultCount, 0),
            uri: path.isAbsolute(worktree) ? `file://${worktree}` : worktree,
            userMessageCount: tasks.reduce((sum, task) => sum + task.userMessageCount, 0),
            worktree,
        }))
        .sort((left, right) => (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0));
};

export const listClineTasksForGroup = async (
    workspaceKey: string,
    dataDir = resolveClineDataDir(),
    cache?: ClineTranscriptCache,
): Promise<ClineTaskSummary[]> => {
    const worktree = getWorktreeFromWorkspaceKey(workspaceKey);
    if (!worktree) {
        return [];
    }
    return (await listClineTranscripts(dataDir, { includeRawPayloads: false }, cache))
        .map(({ task }) => task)
        .filter((task) => task.worktree === worktree)
        .sort((left, right) => (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0));
};

export const readClineTaskTranscript = async (
    dataDir: string,
    taskId: string,
    options: ReadTranscriptOptions = {},
): Promise<ClineTaskTranscript | null> => {
    if (!isSafeClineSessionId(taskId)) {
        return null;
    }
    const entry = await parseSessionEntry(
        await readJson(path.join(dataDir, 'sessions', taskId, `${taskId}.json`)),
        dataDir,
        taskId,
    );
    return entry ? readClineTranscriptFromEntry(entry, options) : null;
};

export const deleteClineTask = async (dataDir: string, taskId: string): Promise<DeleteClineTaskResult> =>
    clineDeleteLimiter(async () => {
        if (!isSafeClineSessionId(taskId)) {
            return { deletedFiles: [], deletedTaskIds: [], indexCleanup: { status: 'not_found' } };
        }
        const sessionDir = path.join(dataDir, 'sessions', taskId);
        const metadataPath = path.join(sessionDir, `${taskId}.json`);
        const messagesPath = path.join(sessionDir, `${taskId}.messages.json`);
        const sessionDirExists = await stat(sessionDir)
            .then(() => true)
            .catch(() => false);
        const hasSessionFiles = (await Bun.file(metadataPath).exists()) || (await Bun.file(messagesPath).exists());
        const indexCleanup = await deleteClineSessionIndex(dataDir, taskId);
        await rm(sessionDir, { force: true, recursive: true });
        const deleted = sessionDirExists || indexCleanup.status === 'deleted';
        if (!deleted && !hasSessionFiles) {
            return { deletedFiles: [], deletedTaskIds: [], indexCleanup };
        }
        return {
            deletedFiles: sessionDirExists ? [sessionDir] : [],
            deletedTaskIds: deleted ? [taskId] : [],
            indexCleanup,
        };
    });
