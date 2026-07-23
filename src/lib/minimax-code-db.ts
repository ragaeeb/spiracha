import path from 'node:path';
import { mapWithConcurrency } from './concurrency';
import type {
    MiniMaxCodeSessionSummary,
    MiniMaxCodeSessionTranscript,
    MiniMaxCodeToolCall,
    MiniMaxCodeToolStatus,
    MiniMaxCodeTranscriptMessage,
    MiniMaxCodeWorkspaceGroup,
} from './minimax-code-exporter-types';
import {
    getDefaultMiniMaxCodeDataDir,
    resolveMiniMaxCodeDataDir,
    resolveMiniMaxCodeSessionsDir,
} from './minimax-code-exporter-types';
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

export { getDefaultMiniMaxCodeDataDir, resolveMiniMaxCodeDataDir, resolveMiniMaxCodeSessionsDir };

const READ_CONCURRENCY = 8;
const WORKSPACE_KEY_PREFIX = 'workspace:';

type ReadSnapshotOptions = {
    includeRawPayloads?: boolean;
};

type SessionStats = {
    assistantMessageCount: number;
    messageCount: number;
    reasoningCount: number;
    renderablePartCount: number;
    toolCallCount: number;
    toolResultCount: number;
    userMessageCount: number;
};

const getWorkspaceKey = (worktree: string): string => `${WORKSPACE_KEY_PREFIX}${encodeURIComponent(worktree)}`;

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

const getWorkspaceLabel = (worktree: string): string => getPortablePathBasename(worktree) || worktree;

const getWorkspaceUri = (worktree: string): string => (path.isAbsolute(worktree) ? `file://${worktree}` : worktree);

const listSnapshotPaths = async (root: string): Promise<string[]> => {
    const entries = await readDirectoryEntriesIfExists(root);
    const nestedPaths = await mapWithConcurrency(
        entries.filter((entry) => entry.isDirectory()),
        READ_CONCURRENCY,
        (entry) => listSnapshotPaths(path.join(root, entry.name)),
    );
    const paths = entries
        .filter((entry) => entry.isFile() && entry.name === 'snapshot.json')
        .map((entry) => path.join(root, entry.name));
    paths.push(...nestedPaths.flat());
    return paths.sort();
};

const parseJsonValue = (value: string | null): JsonValue | null => {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value) as JsonValue;
    } catch {
        return null;
    }
};

const textFromToolResult = (value: string | null): string | null => {
    const parsed = parseJsonValue(value);
    const result = asObject(parsed);
    const content = result?.content;
    if (!Array.isArray(content)) {
        return value?.trim() || null;
    }

    const text = content
        .flatMap((item) => {
            const itemObject = asObject(item);
            const itemText = asString(itemObject?.text ?? null)?.trim();
            return itemText ? [itemText] : [];
        })
        .join('\n\n')
        .trim();
    return text || null;
};

const commandFromToolArguments = (value: string | null): string | null => {
    return asString(asObject(parseJsonValue(value))?.command ?? null)?.trim() || null;
};

const normalizeToolStatus = (value: JsonValue | undefined): MiniMaxCodeToolStatus => {
    if (value === 2 || value === '2') {
        return 'succeeded';
    }
    if (value === 3 || value === '3') {
        return 'failed';
    }
    return 'unknown';
};

const parseToolCall = (value: JsonValue, includeRawPayloads: boolean): MiniMaxCodeToolCall | null => {
    const raw = asObject(value);
    if (!raw) {
        return null;
    }

    const argumentsText = asString(raw.tool_call_args ?? null);
    const resultText = asString(raw.tool_call_result_data ?? null);
    return {
        argumentsText,
        callId: asString(raw.tool_call_id ?? null),
        command: commandFromToolArguments(argumentsText),
        outputText: textFromToolResult(resultText),
        raw: includeRawPayloads ? raw : {},
        status: normalizeToolStatus(raw.tool_call_status),
        toolName: asString(raw.tool_name ?? null)?.trim() || 'unknown',
    };
};

const parseMessageIdentity = (
    raw: Record<string, JsonValue>,
): Pick<MiniMaxCodeTranscriptMessage, 'messageId' | 'messageType' | 'role'> | null => {
    const messageType = asNumber(raw.msg_type ?? null);
    if (messageType !== 1 && messageType !== 2) {
        return null;
    }

    const role = asString(raw.role ?? null);
    if (role !== 'assistant' && role !== 'user') {
        return null;
    }

    const messageId = asString(raw.msg_id ?? null)?.trim();
    return messageId ? { messageId, messageType, role } : null;
};

const parseToolCalls = (value: JsonValue | undefined, includeRawPayloads: boolean): MiniMaxCodeToolCall[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((toolCall) => {
        const parsed = parseToolCall(toolCall, includeRawPayloads);
        return parsed ? [parsed] : [];
    });
};

const parseMessage = (value: JsonValue, includeRawPayloads: boolean): MiniMaxCodeTranscriptMessage | null => {
    const raw = asObject(value);
    if (!raw) {
        return null;
    }

    const identity = parseMessageIdentity(raw);
    if (!identity) {
        return null;
    }

    return {
        content: asString(raw.msg_content ?? null)?.trim() || null,
        createdAtMs: asNumber(raw.timestamp ?? null),
        finishReason: asString(raw.finish_reason ?? null),
        ...identity,
        raw: includeRawPayloads ? raw : {},
        reasoning: asString(raw.thinking_content ?? null)?.trim() || null,
        thinkingDurationMs: asNumber(raw.thinking_duration_ms ?? null),
        toolCalls: parseToolCalls(raw.tool_calls, includeRawPayloads),
    };
};

const getSessionStats = (messages: MiniMaxCodeTranscriptMessage[]): SessionStats => {
    const toolCalls = messages.flatMap((message) => message.toolCalls);
    const userMessageCount = messages.filter((message) => message.role === 'user').length;
    const assistantMessageCount = messages.filter((message) => message.role === 'assistant').length;
    const reasoningCount = messages.filter((message) => Boolean(message.reasoning)).length;
    const toolResultCount = toolCalls.filter((toolCall) => Boolean(toolCall.outputText)).length;
    const renderablePartCount =
        messages.filter((message) => Boolean(message.content)).length +
        reasoningCount +
        toolCalls.length +
        toolResultCount;
    return {
        assistantMessageCount,
        messageCount: userMessageCount + assistantMessageCount,
        reasoningCount,
        renderablePartCount,
        toolCallCount: toolCalls.length,
        toolResultCount,
        userMessageCount,
    };
};

const toSessionSummary = (
    snapshotPath: string,
    record: Record<string, JsonValue>,
    sessionId: string,
    messages: MiniMaxCodeTranscriptMessage[],
): MiniMaxCodeSessionSummary | null => {
    const worktree = asString(record.workspaceDir ?? null)?.trim();
    if (!worktree) {
        return null;
    }

    const stats = getSessionStats(messages);
    const title = cleanInlineTitle(asString(record.title ?? null) || sessionId) || sessionId;
    return {
        agentName: asString(record.agentName ?? null),
        appMode: asString(record.appMode ?? null),
        archived: asBoolean(record.archived ?? null),
        ...stats,
        createdAtMs: asNumber(record.createdAtMs ?? null),
        currentModelId: asString(record.effectiveModel ?? null),
        currentModelVariant: asString(record.effectiveModelVariant ?? null),
        lastActiveAtMs: asNumber(record.updatedAtMs ?? null),
        runtime: asString(record.runtime ?? null),
        sessionDir: path.dirname(snapshotPath),
        sessionId,
        sessionType: asString(record.sessionType ?? null),
        snapshotPath,
        status: asString(record.status ?? null),
        title,
        workspaceKey: getWorkspaceKey(worktree),
        workspaceLabel: getWorkspaceLabel(worktree),
        worktree,
    };
};

const readSnapshot = async (
    snapshotPath: string,
    options: ReadSnapshotOptions = {},
): Promise<MiniMaxCodeSessionTranscript | null> => {
    const parsed = (await Bun.file(snapshotPath)
        .json()
        .catch(() => null)) as JsonValue | null;
    const root = asObject(parsed);
    const record = asObject(root?.record ?? null);
    const sessionId = asString(record?.sessionId ?? null) ?? asString(root?.sessionId ?? null);
    if (!root || !record || !sessionId || !Array.isArray(root.displayMessages)) {
        return null;
    }

    const includeRawPayloads = options.includeRawPayloads ?? true;
    const messages = root.displayMessages.flatMap((message) => {
        const parsedMessage = parseMessage(message, includeRawPayloads);
        return parsedMessage ? [parsedMessage] : [];
    });
    const session = toSessionSummary(snapshotPath, record, sessionId, messages);
    if (!session) {
        return null;
    }

    return {
        messages,
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
        renderablePartCount: session.renderablePartCount,
        session,
    };
};

const listSessionTranscripts = async (
    sessionsDir: string,
    options: ReadSnapshotOptions = {},
): Promise<MiniMaxCodeSessionTranscript[]> => {
    const snapshotPaths = await listSnapshotPaths(sessionsDir);
    const transcripts = await mapWithConcurrency(snapshotPaths, READ_CONCURRENCY, (snapshotPath) =>
        readSnapshot(snapshotPath, options),
    );
    return transcripts.flatMap((transcript) => (transcript?.session.messageCount ? [transcript] : []));
};

const compareNullableMsDesc = (left: number | null, right: number | null): number => (right ?? 0) - (left ?? 0);

const sumSessions = (sessions: MiniMaxCodeSessionSummary[], key: keyof SessionStats): number => {
    return sessions.reduce((total, session) => total + session[key], 0);
};

const toWorkspaceGroup = (worktree: string, sessions: MiniMaxCodeSessionSummary[]): MiniMaxCodeWorkspaceGroup => {
    const lastActiveAtMs = sessions.reduce<number | null>((latest, session) => {
        if (session.lastActiveAtMs === null) {
            return latest;
        }
        return latest === null ? session.lastActiveAtMs : Math.max(latest, session.lastActiveAtMs);
    }, null);
    return {
        assistantMessageCount: sumSessions(sessions, 'assistantMessageCount'),
        key: getWorkspaceKey(worktree),
        label: getWorkspaceLabel(worktree),
        lastActiveAtMs,
        messageCount: sumSessions(sessions, 'messageCount'),
        reasoningCount: sumSessions(sessions, 'reasoningCount'),
        sessionCount: sessions.length,
        toolCallCount: sumSessions(sessions, 'toolCallCount'),
        toolResultCount: sumSessions(sessions, 'toolResultCount'),
        uri: getWorkspaceUri(worktree),
        userMessageCount: sumSessions(sessions, 'userMessageCount'),
        worktree,
    };
};

export const listMiniMaxCodeWorkspaceGroups = async (
    sessionsDir = resolveMiniMaxCodeSessionsDir(),
): Promise<MiniMaxCodeWorkspaceGroup[]> => {
    const transcripts = await listSessionTranscripts(sessionsDir, { includeRawPayloads: false });
    const sessionsByWorktree = new Map<string, MiniMaxCodeSessionSummary[]>();
    for (const transcript of transcripts) {
        const sessions = sessionsByWorktree.get(transcript.session.worktree) ?? [];
        sessions.push(transcript.session);
        sessionsByWorktree.set(transcript.session.worktree, sessions);
    }

    return [...sessionsByWorktree.entries()]
        .map(([worktree, sessions]) => toWorkspaceGroup(worktree, sessions))
        .sort(
            (left, right) =>
                compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) ||
                left.worktree.localeCompare(right.worktree),
        );
};

export const listMiniMaxCodeSessionsForGroup = async (
    workspaceKey: string,
    sessionsDir = resolveMiniMaxCodeSessionsDir(),
): Promise<MiniMaxCodeSessionSummary[]> => {
    const worktree = getWorktreeFromWorkspaceKey(workspaceKey);
    if (!worktree) {
        return [];
    }

    return (await listSessionTranscripts(sessionsDir, { includeRawPayloads: false }))
        .map((transcript) => transcript.session)
        .filter((session) => session.worktree === worktree)
        .sort(
            (left, right) =>
                compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) ||
                left.title.localeCompare(right.title),
        );
};

export const readMiniMaxCodeSessionTranscript = async (
    sessionsDir: string,
    sessionId: string,
    options: ReadSnapshotOptions = {},
): Promise<MiniMaxCodeSessionTranscript | null> => {
    if (!/^mvs_[A-Za-z0-9]+$/u.test(sessionId)) {
        return null;
    }

    const snapshotPaths = await listSnapshotPaths(sessionsDir);
    for (const snapshotPath of snapshotPaths) {
        const transcript = await readSnapshot(snapshotPath, options);
        if (transcript?.session.sessionId === sessionId) {
            return transcript;
        }
    }
    return null;
};
