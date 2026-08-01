import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
    ClineTaskSummary,
    ClineTaskTranscript,
    ClineToolEvidence,
    ClineTranscriptMessage,
    ClineWorkspaceGroup,
    DeleteClineTaskResult,
} from './cline-exporter-types';
import { getDefaultClineGlobalStorageDir, resolveClineGlobalStorageDir } from './cline-exporter-types';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import { getPortablePathBasename } from './portable-path';
import { asBoolean, asNumber, asObject, asString, cleanInlineTitle, type JsonValue } from './shared';

export { getDefaultClineGlobalStorageDir, resolveClineGlobalStorageDir };

const WORKSPACE_KEY_PREFIX = 'workspace:';
const READ_CONCURRENCY = 8;
const clineDeleteLimiter = createConcurrencyLimiter(1);

type ReadTranscriptOptions = { includeRawPayloads?: boolean };

type TaskHistoryEntry = {
    cacheReads: number | null;
    cacheWrites: number | null;
    cwd: string;
    id: string;
    isFavorited: boolean;
    modelId: string | null;
    task: string;
    tokensIn: number | null;
    tokensOut: number | null;
    totalCost: number | null;
    ts: number | null;
    ulid: string | null;
};

type ParsedStats = {
    assistantMessageCount: number;
    messageCount: number;
    reasoningCount: number;
    toolCallCount: number;
    toolResultCount: number;
    userMessageCount: number;
};

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

const parseTaskHistoryEntry = (value: JsonValue): TaskHistoryEntry | null => {
    const raw = asObject(value);
    const id = asString(raw?.id ?? null)?.trim();
    const cwd = asString(raw?.cwdOnTaskInitialization ?? null)?.trim();
    if (!raw || !id || !cwd) {
        return null;
    }
    return {
        cacheReads: asNumber(raw.cacheReads ?? null),
        cacheWrites: asNumber(raw.cacheWrites ?? null),
        cwd,
        id,
        isFavorited: asBoolean(raw.isFavorited ?? null),
        modelId: asString(raw.modelId ?? null),
        task: asString(raw.task ?? null) ?? id,
        tokensIn: asNumber(raw.tokensIn ?? null),
        tokensOut: asNumber(raw.tokensOut ?? null),
        totalCost: asNumber(raw.totalCost ?? null),
        ts: asNumber(raw.ts ?? null),
        ulid: asString(raw.ulid ?? null),
    };
};

const readTaskHistory = async (globalStorageDir: string): Promise<TaskHistoryEntry[]> => {
    const value = await readJson(path.join(globalStorageDir, 'state', 'taskHistory.json'));
    return Array.isArray(value) ? value.flatMap((entry) => parseTaskHistoryEntry(entry) ?? []) : [];
};

const toolStatusFromCommand = (raw: Record<string, JsonValue>): ClineToolEvidence['status'] => {
    if (raw.commandCompleted === true) {
        return 'succeeded';
    }
    return raw.commandCompleted === false ? 'failed' : 'unknown';
};

const textFromToolInput = (raw: Record<string, JsonValue>): string | null => {
    const fields = Object.entries(raw)
        .filter(([key]) => !['content', 'tool'].includes(key))
        .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    return fields.length ? fields.join('\n') : null;
};

type ClineMessageFields = Omit<ClineTranscriptMessage, 'createdAtMs' | 'messageId' | 'raw'>;

const simpleMessageFields = (say: string | null, text: string): ClineMessageFields | null => {
    const definitions: Record<string, Pick<ClineMessageFields, 'phase' | 'role'>> = {
        completion_result: { phase: 'final_answer', role: 'assistant' },
        reasoning: { phase: 'reasoning', role: 'assistant' },
        resume_task: { phase: 'unknown', role: 'user' },
        task: { phase: 'unknown', role: 'user' },
        text: { phase: 'commentary', role: 'assistant' },
        user_feedback: { phase: 'unknown', role: 'user' },
    };
    const definition = say ? definitions[say] : null;
    return definition ? { ...definition, text, tool: null } : null;
};

const commandMessageFields = (
    raw: Record<string, JsonValue>,
    text: string,
    callId: string,
    worktree: string,
    includeRawPayloads: boolean,
): ClineMessageFields => ({
    phase: 'tool_call',
    role: 'assistant',
    text,
    tool: {
        callId,
        command: text,
        inputText: text,
        name: 'execute_command',
        outputText: null,
        raw: includeRawPayloads ? raw : {},
        status: toolStatusFromCommand(raw),
        workdir: worktree,
    },
});

const commandOutputFields = (
    raw: Record<string, JsonValue>,
    text: string,
    callId: string,
    worktree: string,
    includeRawPayloads: boolean,
): ClineMessageFields => ({
    phase: 'tool_output',
    role: 'tool',
    text,
    tool: {
        callId,
        command: null,
        inputText: null,
        name: 'execute_command',
        outputText: text,
        raw: includeRawPayloads ? raw : {},
        status: 'unknown',
        workdir: worktree,
    },
});

const parseJsonObject = (text: string): Record<string, JsonValue> | null => {
    try {
        return asObject(JSON.parse(text) as JsonValue);
    } catch {
        return null;
    }
};

const toolMessageFields = (
    raw: Record<string, JsonValue>,
    text: string,
    callId: string,
    worktree: string,
    includeRawPayloads: boolean,
): ClineMessageFields[] => {
    const parsed = parseJsonObject(text);
    const toolName = asString(parsed?.tool ?? null)?.trim() || 'unknown';
    const outputText = asString(parsed?.content ?? null)?.trim() || null;
    const inputText = parsed ? textFromToolInput(parsed) : text;
    const tool: ClineToolEvidence = {
        callId,
        command: null,
        inputText,
        name: toolName,
        outputText: null,
        raw: includeRawPayloads ? (parsed ?? raw) : {},
        status: outputText ? 'succeeded' : 'unknown',
        workdir: worktree,
    };
    const messages: ClineMessageFields[] = [
        {
            phase: 'tool_call',
            role: 'assistant',
            text: [toolName, inputText].filter(Boolean).join(': '),
            tool,
        },
    ];
    if (outputText) {
        messages.push({
            phase: 'tool_output',
            role: 'tool',
            text: outputText,
            tool: { ...tool, inputText: null, outputText },
        });
    }
    return messages;
};

type ParsedUiItem = {
    fields: ClineMessageFields[];
    pendingCommandCallId: string | null;
    raw: Record<string, JsonValue> | null;
};

const classifyUiMessage = (
    raw: Record<string, JsonValue>,
    text: string,
    index: number,
    pendingCommandCallId: string | null,
    worktree: string,
    includeRawPayloads: boolean,
): Pick<ParsedUiItem, 'fields' | 'pendingCommandCallId'> => {
    const say = asString(raw.say ?? null);
    const simpleFields = simpleMessageFields(say, text);
    if (simpleFields) {
        return { fields: [simpleFields], pendingCommandCallId };
    }
    if (say === 'command') {
        const callId = `cline-command-${asNumber(raw.ts ?? null) ?? index}`;
        return {
            fields: [commandMessageFields(raw, text, callId, worktree, includeRawPayloads)],
            pendingCommandCallId: callId,
        };
    }
    if (asString(raw.ask ?? null) === 'command_output') {
        const callId = pendingCommandCallId ?? `cline-command-output-${asNumber(raw.ts ?? null) ?? index}`;
        return {
            fields: [commandOutputFields(raw, text, callId, worktree, includeRawPayloads)],
            pendingCommandCallId: null,
        };
    }
    if (say === 'tool') {
        const callId = `cline-tool-${asNumber(raw.ts ?? null) ?? index}`;
        return {
            fields: toolMessageFields(raw, text, callId, worktree, includeRawPayloads),
            pendingCommandCallId,
        };
    }
    return { fields: [], pendingCommandCallId };
};

const parseUiItem = (
    item: JsonValue,
    index: number,
    pendingCommandCallId: string | null,
    worktree: string,
    includeRawPayloads: boolean,
): ParsedUiItem => {
    const raw = asObject(item);
    const text = asString(raw?.text ?? null)?.trim();
    if (!raw || !text) {
        return { fields: [], pendingCommandCallId, raw: null };
    }
    return {
        ...classifyUiMessage(raw, text, index, pendingCommandCallId, worktree, includeRawPayloads),
        raw,
    };
};

const parseUiMessages = (value: JsonValue, worktree: string, includeRawPayloads: boolean): ClineTranscriptMessage[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    const messages: ClineTranscriptMessage[] = [];
    let pendingCommandCallId: string | null = null;
    const addMessage = (raw: Record<string, JsonValue>, index: number, fields: ClineMessageFields) => {
        const createdAtMs = asNumber(raw.ts ?? null);
        messages.push({
            createdAtMs,
            messageId: `cline-${createdAtMs ?? 'unknown'}-${index}-${messages.length}`,
            raw: includeRawPayloads ? raw : {},
            ...fields,
        });
    };

    value.forEach((item, index) => {
        const parsed = parseUiItem(item, index, pendingCommandCallId, worktree, includeRawPayloads);
        pendingCommandCallId = parsed.pendingCommandCallId;
        parsed.fields.forEach((fields) => {
            if (parsed.raw) {
                addMessage(parsed.raw, index, fields);
            }
        });
    });
    return messages;
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

const readTaskTranscriptFromEntry = async (
    globalStorageDir: string,
    entry: TaskHistoryEntry,
    options: ReadTranscriptOptions = {},
): Promise<ClineTaskTranscript | null> => {
    const taskDir = path.join(globalStorageDir, 'tasks', entry.id);
    const uiMessagesPath = path.join(taskDir, 'ui_messages.json');
    const includeRawPayloads = options.includeRawPayloads ?? true;
    const messages = parseUiMessages(await readJson(uiMessagesPath), entry.cwd, includeRawPayloads);
    if (messages.length === 0) {
        return null;
    }
    const stats = getStats(messages);
    const createdAtMs = messages.reduce<number | null>((earliest, message) => {
        if (message.createdAtMs === null) {
            return earliest;
        }
        return earliest === null ? message.createdAtMs : Math.min(earliest, message.createdAtMs);
    }, null);
    const title = cleanInlineTitle(entry.task) || entry.id;
    const task: ClineTaskSummary = {
        ...stats,
        cacheReads: entry.cacheReads,
        cacheWrites: entry.cacheWrites,
        createdAtMs,
        isFavorited: entry.isFavorited,
        lastActiveAtMs: entry.ts,
        modelId: entry.modelId,
        renderablePartCount: messages.length,
        taskDir,
        taskId: entry.id,
        title,
        tokensIn: entry.tokensIn,
        tokensOut: entry.tokensOut,
        totalCost: entry.totalCost,
        uiMessagesPath,
        ulid: entry.ulid,
        workspaceKey: getWorkspaceKey(entry.cwd),
        workspaceLabel: getPortablePathBasename(entry.cwd) || entry.cwd,
        worktree: entry.cwd,
    };
    return {
        messages,
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
        renderablePartCount: messages.length,
        task,
    };
};

const listTaskTranscripts = async (globalStorageDir: string, options: ReadTranscriptOptions = {}) => {
    const entries = await readTaskHistory(globalStorageDir);
    const transcripts = await mapWithConcurrency(entries, READ_CONCURRENCY, (entry) =>
        readTaskTranscriptFromEntry(globalStorageDir, entry, options),
    );
    return transcripts.flatMap((transcript) => transcript ?? []);
};

export const listClineWorkspaceGroups = async (
    globalStorageDir = resolveClineGlobalStorageDir(),
): Promise<ClineWorkspaceGroup[]> => {
    const transcripts = await listTaskTranscripts(globalStorageDir, { includeRawPayloads: false });
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
    globalStorageDir = resolveClineGlobalStorageDir(),
): Promise<ClineTaskSummary[]> => {
    const worktree = getWorktreeFromWorkspaceKey(workspaceKey);
    if (!worktree) {
        return [];
    }
    return (await listTaskTranscripts(globalStorageDir, { includeRawPayloads: false }))
        .map(({ task }) => task)
        .filter((task) => task.worktree === worktree)
        .sort((left, right) => (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0));
};

export const readClineTaskTranscript = async (
    globalStorageDir: string,
    taskId: string,
    options: ReadTranscriptOptions = {},
): Promise<ClineTaskTranscript | null> => {
    if (!/^\d+$/u.test(taskId)) {
        return null;
    }
    const entry = (await readTaskHistory(globalStorageDir)).find((candidate) => candidate.id === taskId);
    return entry ? readTaskTranscriptFromEntry(globalStorageDir, entry, options) : null;
};

export const deleteClineTask = async (globalStorageDir: string, taskId: string): Promise<DeleteClineTaskResult> =>
    clineDeleteLimiter(async () => {
        if (!/^\d+$/u.test(taskId)) {
            return { deletedFiles: [], deletedTaskIds: [] };
        }
        const taskHistoryPath = path.join(globalStorageDir, 'state', 'taskHistory.json');
        const rawHistory = await readJson(taskHistoryPath);
        if (!Array.isArray(rawHistory)) {
            return { deletedFiles: [], deletedTaskIds: [] };
        }
        const remaining = rawHistory.filter((value) => asString(asObject(value)?.id ?? null) !== taskId);
        if (remaining.length === rawHistory.length) {
            return { deletedFiles: [], deletedTaskIds: [] };
        }

        await mkdir(path.dirname(taskHistoryPath), { recursive: true });
        const tempPath = `${taskHistoryPath}.${randomUUID()}.tmp`;
        await Bun.write(tempPath, `${JSON.stringify(remaining, null, 2)}\n`);
        await rename(tempPath, taskHistoryPath);
        const taskDir = path.join(globalStorageDir, 'tasks', taskId);
        await rm(taskDir, { force: true, recursive: true });
        return { deletedFiles: [taskDir, taskHistoryPath], deletedTaskIds: [taskId] };
    });
