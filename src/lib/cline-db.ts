import { Database } from 'bun:sqlite';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
    ClineIndexCleanupResult,
    ClineTaskSummary,
    ClineTaskTranscript,
    ClineToolEvidence,
    ClineTranscriptMessage,
    ClineWorkspaceGroup,
    DeleteClineTaskResult,
} from './cline-exporter-types';
import { isSafeClineSessionId, resolveClineDataDir } from './cline-exporter-types';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import { getPortablePathBasename } from './portable-path';
import {
    asBoolean,
    asNumber,
    asObject,
    asString,
    cleanInlineTitle,
    type JsonValue,
    readDirectoryEntriesIfExists,
} from './shared';

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

type ClineStoredMessage = {
    content: JsonValue[];
    id: string | null;
    role: string | null;
    ts: number | null;
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

const timestampFromJson = (value: JsonValue | null): number | null => {
    const numeric = asNumber(value);
    if (numeric !== null) {
        return numeric;
    }
    const text = asString(value);
    if (!text) {
        return null;
    }
    const timestamp = Date.parse(text);
    return Number.isNaN(timestamp) ? null : timestamp;
};

const textFromClineValue = (value: JsonValue | null): string => {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => textFromClineValue(item))
            .filter(Boolean)
            .join('\n');
    }
    const raw = asObject(value);
    if (!raw) {
        return value === null ? '' : JSON.stringify(value);
    }
    for (const key of ['text', 'thinking', 'result', 'error']) {
        const text = asString(raw[key] ?? null);
        if (text !== null) {
            return text;
        }
    }
    if (raw.content !== undefined) {
        return textFromClineValue(raw.content);
    }
    return Object.entries(raw)
        .map(([key, item]) => `${key}: ${textFromClineValue(item)}`)
        .join('\n');
};

const valueAsText = (value: JsonValue | null): string | null => {
    if (value === null) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    return JSON.stringify(value);
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

const parseStoredMessage = (value: JsonValue): ClineStoredMessage | null => {
    const raw = asObject(value);
    if (!raw || !Array.isArray(raw.content)) {
        return null;
    }
    return {
        content: raw.content,
        id: asString(raw.id ?? null),
        role: asString(raw.role ?? null),
        ts: timestampFromJson(raw.ts ?? null),
    };
};

const rawPart = (part: Record<string, JsonValue>, message: ClineStoredMessage): Record<string, JsonValue> => ({
    ...part,
    messageId: message.id,
    messageRole: message.role,
});

type ClineMessageFields = Omit<ClineTranscriptMessage, 'createdAtMs' | 'messageId' | 'raw'>;

const roleForStoredMessage = (role: string | null): ClineTranscriptMessage['role'] => {
    if (role === 'assistant') {
        return 'assistant';
    }
    if (role === 'user') {
        return 'user';
    }
    return 'unknown';
};

const parseThinkingPart = (part: Record<string, JsonValue>): ClineMessageFields => ({
    phase: 'reasoning',
    role: 'assistant',
    text: textFromClineValue(part.thinking ?? part.text ?? null),
    tool: null,
});

const parseTextPart = (part: Record<string, JsonValue>, message: ClineStoredMessage): ClineMessageFields => {
    const role = roleForStoredMessage(message.role);
    return {
        phase: role === 'assistant' ? 'commentary' : 'unknown',
        role,
        text: textFromClineValue(part.text ?? null),
        tool: null,
    };
};

const parseToolUsePart = (
    part: Record<string, JsonValue>,
    message: ClineStoredMessage,
    worktree: string,
): ClineMessageFields => {
    const callId = asString(part.id ?? null) || `cline-tool-${message.id ?? 'unknown'}`;
    const inputText = valueAsText(part.input ?? null);
    const name = asString(part.name ?? null)?.trim() || 'unknown';
    return {
        phase: 'tool_call',
        role: 'assistant',
        text: [name, inputText].filter(Boolean).join(': '),
        tool: {
            callId,
            command: null,
            inputText,
            name,
            outputText: null,
            raw: rawPart(part, message),
            status: 'unknown',
            workdir: worktree,
        },
    };
};

const parseToolResultPart = (
    part: Record<string, JsonValue>,
    message: ClineStoredMessage,
    worktree: string,
): ClineMessageFields => {
    const callId = asString(part.tool_use_id ?? null) || `cline-tool-result-${message.id ?? 'unknown'}`;
    const outputText = textFromClineValue(part.content ?? part.result ?? null);
    const tool: ClineToolEvidence = {
        callId,
        command: null,
        inputText: null,
        name: asString(part.name ?? null)?.trim() || 'unknown',
        outputText: outputText || null,
        raw: rawPart(part, message),
        status: part.is_error === true ? 'failed' : 'succeeded',
        workdir: worktree,
    };
    return {
        phase: 'tool_output',
        role: 'tool',
        text: outputText,
        tool,
    };
};

const parseStoredPart = (
    part: Record<string, JsonValue>,
    message: ClineStoredMessage,
    worktree: string,
): ClineMessageFields | null => {
    switch (asString(part.type ?? null)) {
        case 'thinking':
            return parseThinkingPart(part);
        case 'text':
            return parseTextPart(part, message);
        case 'tool_use':
            return parseToolUsePart(part, message, worktree);
        case 'tool_result':
            return parseToolResultPart(part, message, worktree);
        default:
            return null;
    }
};

const parseSessionMessages = (
    value: JsonValue,
    worktree: string,
    sessionId: string,
    includeRawPayloads: boolean,
): ClineTranscriptMessage[] => {
    const envelope = asObject(value);
    if (!Array.isArray(envelope?.messages)) {
        return [];
    }
    const messages: ClineTranscriptMessage[] = [];
    envelope.messages.forEach((value, messageIndex) => {
        const message = parseStoredMessage(value);
        if (!message) {
            return;
        }
        message.content.forEach((partValue, partIndex) => {
            const part = asObject(partValue);
            if (!part) {
                return;
            }
            const fields = parseStoredPart(part, message, worktree);
            if (!fields?.text) {
                return;
            }
            messages.push({
                createdAtMs: message.ts,
                messageId: `cline-${sessionId}-${message.id ?? messageIndex}-${partIndex}`,
                raw: includeRawPayloads ? rawPart(part, message) : {},
                ...fields,
            });
        });
    });
    const finalAnswerIndex = [...messages]
        .map((message, index) => ({ index, message }))
        .reverse()
        .find(({ message }) => message.role === 'assistant' && message.phase === 'commentary')?.index;
    if (finalAnswerIndex !== undefined) {
        messages[finalAnswerIndex] = { ...messages[finalAnswerIndex]!, phase: 'final_answer' };
    }
    return messages;
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
    const messages = parseSessionMessages(await readJson(entry.messagesPath), entry.cwd, entry.id, includeRawPayloads);
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
