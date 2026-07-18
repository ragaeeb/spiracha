import { randomUUID } from 'node:crypto';
import { chmod, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import {
    type GrokSessionSummary,
    type GrokSessionTranscript,
    type GrokTranscriptEntry,
    type GrokTranscriptPart,
    type GrokWorkspaceGroup,
    getDefaultGrokHome,
    resolveGrokHome,
    resolveGrokSessionsDir,
} from './grok-exporter-types';
import { getPortablePathBasename } from './portable-path';
import {
    asNumber,
    asObject,
    asString,
    cleanExtractedText,
    cleanInlineTitle,
    isWorkspacePathQuery,
    type JsonValue,
    readDirectoryEntriesIfExists,
    readJsonlObjects,
    workspacePathMatchesQuery,
} from './shared';

export { getDefaultGrokHome, resolveGrokHome, resolveGrokSessionsDir };

const READ_CONCURRENCY = 8;
const DELETE_CONCURRENCY = 1;
const WORKSPACE_KEY_PREFIX = 'workspace:';
const grokDeleteLimiter = createConcurrencyLimiter(DELETE_CONCURRENCY);

type GrokSessionDirectory = {
    directoryName: string;
    sessionDir: string;
};

type ReadGrokSessionTranscriptOptions = {
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

type SummaryIdentity = {
    agentName: string | null;
    createdAtMs: number | null;
    currentModelId: string | null;
    cwd: string | null;
    gitBranch: string | null;
    gitRemotes: string[];
    gitRootDir: string | null;
    headCommit: string | null;
    lastActiveAtMs: number | null;
    messageCount: number | null;
    sandboxProfile: string | null;
    sessionId: string | null;
    title: string | null;
};

export type DeleteGrokSessionResult = {
    deletedFiles: string[];
    deletedSessionIds: string[];
};

const pathExists = async (target: string): Promise<boolean> => {
    return await stat(target)
        .then(() => true)
        .catch(() => false);
};

const toIso = (value: number | null): string | null => {
    return value === null ? null : new Date(value).toISOString();
};

const parseTimestampMs = (value: JsonValue | undefined): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    }

    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const cleanLabel = (value: string | null | undefined): string | null => {
    const cleaned = value?.replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned : null;
};

const getWorkspaceKey = (directoryName: string): string => `${WORKSPACE_KEY_PREFIX}${directoryName}`;

const getDirectoryNameFromWorkspaceKey = (workspaceKey: string): string | null => {
    return workspaceKey.startsWith(WORKSPACE_KEY_PREFIX) ? workspaceKey.slice(WORKSPACE_KEY_PREFIX.length) : null;
};

const decodeWorkspaceDirectoryName = (directoryName: string): string => {
    try {
        return decodeURIComponent(directoryName);
    } catch {
        return directoryName;
    }
};

const getWorkspaceLabel = (worktree: string): string => {
    return getPortablePathBasename(worktree) || worktree;
};

const getWorkspaceUri = (worktree: string): string => {
    return worktree.startsWith(path.sep) ? `file://${worktree}` : worktree;
};

const getGrokHomeFromSessionsDir = (sessionsDir: string): string => {
    return path.basename(sessionsDir) === 'sessions' ? path.dirname(sessionsDir) : resolveGrokHome();
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

const readJsonObjectFile = async (filePath: string): Promise<Record<string, JsonValue> | null> => {
    const raw = (await Bun.file(filePath)
        .json()
        .catch(() => null)) as JsonValue | null;
    return asObject(raw);
};

const listJsonFiles = async (dirPath: string): Promise<string[]> => {
    const entries = await readDirectoryEntriesIfExists(dirPath);
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(dirPath, entry.name))
        .sort();
};

const getJsonObjectList = (value: JsonValue | undefined): Record<string, JsonValue>[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((item) => {
        const object = asObject(item);
        return object ? [object] : [];
    });
};

const textFromContentValue = (value: JsonValue | undefined): string => {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                const object = asObject(item);
                if (!object) {
                    return '';
                }

                return (
                    asString(object.text ?? null) ??
                    asString(object.content ?? null) ??
                    textFromContentValue(object.content) ??
                    ''
                );
            })
            .filter(Boolean)
            .join('\n\n');
    }

    const object = asObject(value ?? null);
    return object ? (asString(object.text ?? null) ?? asString(object.content ?? null) ?? '') : '';
};

const unwrapGrokTextEnvelope = (text: string): string => {
    const trimmed = text.trim();
    const userQuery = trimmed.match(/^<user_query>\s*([\s\S]*?)\s*<\/user_query>$/u);
    return userQuery?.[1]?.trim() ?? trimmed;
};

const isGrokSystemContextEnvelope = (text: string): boolean => {
    const trimmed = text.trimStart();
    return (
        trimmed.startsWith('<user_info>') ||
        trimmed.startsWith('<summary_request>') ||
        trimmed.startsWith('<system-reminder>')
    );
};

const getReasoningText = (raw: Record<string, JsonValue>): string => {
    const summary = Array.isArray(raw.summary) ? raw.summary : [];
    const summaryText = summary
        .map((item) => {
            const object = asObject(item);
            return asString(object?.summary_text ?? null) ?? asString(object?.text ?? null) ?? '';
        })
        .filter(Boolean)
        .join('\n\n');

    return summaryText || asString(raw.content ?? null) || '';
};

const parseToolCallPart = (
    raw: Record<string, JsonValue>,
    entryId: string,
    index: number,
    includeRawPayloads: boolean,
): GrokTranscriptPart | null => {
    const toolName = asString(raw.name ?? null) ?? 'unknown';
    const argumentsText = formatJsonLike(raw.arguments);
    return {
        argumentsText,
        partId: `${entryId}:tool-call:${index}`,
        raw: includeRawPayloads ? raw : {},
        toolCallId: asString(raw.id ?? null),
        toolName,
        type: 'tool_call',
    };
};

const parseAssistantParts = (
    raw: Record<string, JsonValue>,
    entryId: string,
    includeRawPayloads: boolean,
): GrokTranscriptPart[] => {
    const parts: GrokTranscriptPart[] = [];
    const text = textFromContentValue(raw.content);
    if (text.trim()) {
        parts.push({
            partId: `${entryId}:text`,
            raw: includeRawPayloads ? { content: text } : {},
            text,
            type: 'text',
        });
    }

    const toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
    toolCalls.forEach((item, index) => {
        const object = asObject(item);
        const part = object ? parseToolCallPart(object, entryId, index, includeRawPayloads) : null;
        if (part) {
            parts.push(part);
        }
    });

    return parts;
};

const parseTextEntryPart = (
    raw: Record<string, JsonValue>,
    entryId: string,
    includeRawPayloads: boolean,
): GrokTranscriptPart[] => {
    const text = unwrapGrokTextEnvelope(textFromContentValue(raw.content));
    return text
        ? [
              {
                  partId: `${entryId}:text`,
                  raw: includeRawPayloads ? raw : {},
                  text,
                  type: 'text',
              },
          ]
        : [];
};

const parseReasoningParts = (
    raw: Record<string, JsonValue>,
    entryId: string,
    includeRawPayloads: boolean,
): GrokTranscriptPart[] => {
    const text = getReasoningText(raw).trim();
    return text
        ? [
              {
                  partId: `${entryId}:reasoning`,
                  raw: includeRawPayloads ? raw : {},
                  text,
                  type: 'reasoning',
              },
          ]
        : [];
};

const parseToolResultParts = (
    raw: Record<string, JsonValue>,
    entryId: string,
    includeRawPayloads: boolean,
): GrokTranscriptPart[] => {
    const outputText = textFromContentValue(raw.content).trim();
    return outputText
        ? [
              {
                  outputText,
                  partId: `${entryId}:tool-result`,
                  raw: includeRawPayloads ? raw : {},
                  toolCallId: asString(raw.tool_call_id ?? null),
                  type: 'tool_result',
              },
          ]
        : [];
};

const getEntryRole = (type: string): string => {
    if (type === 'system' || type === 'user' || type === 'assistant') {
        return type;
    }

    if (type === 'reasoning') {
        return 'assistant';
    }

    if (type === 'tool_result') {
        return 'tool';
    }

    return 'unknown';
};

const getTranscriptEntryRole = (type: string, parts: GrokTranscriptPart[]): string => {
    if (type === 'user' && parts.some((part) => part.type === 'text' && isGrokSystemContextEnvelope(part.text ?? ''))) {
        return 'system';
    }

    return getEntryRole(type);
};

const parseTranscriptEntry = (
    raw: Record<string, JsonValue>,
    sessionId: string,
    index: number,
    includeRawPayloads: boolean,
): GrokTranscriptEntry | null => {
    const type = asString(raw.type ?? null) ?? 'unknown';
    const entryId = asString(raw.id ?? null) ?? `${sessionId}:${index}`;
    const parts =
        type === 'assistant'
            ? parseAssistantParts(raw, entryId, includeRawPayloads)
            : type === 'reasoning'
              ? parseReasoningParts(raw, entryId, includeRawPayloads)
              : type === 'tool_result'
                ? parseToolResultParts(raw, entryId, includeRawPayloads)
                : parseTextEntryPart(raw, entryId, includeRawPayloads);

    if (parts.length === 0) {
        return null;
    }

    return {
        createdAtMs: null,
        entryId,
        modelFingerprint: asString(raw.model_fingerprint ?? null),
        modelId: asString(raw.model_id ?? null),
        parts,
        raw: includeRawPayloads ? raw : {},
        role: getTranscriptEntryRole(type, parts),
        timestamp: null,
        type,
    };
};

const readGrokChatHistory = async (
    sessionDir: string,
    chatHistoryPath: string,
): Promise<Record<string, JsonValue>[]> => {
    const liveEvents: Record<string, JsonValue>[] = [];
    for await (const raw of readJsonlObjects(chatHistoryPath)) {
        liveEvents.push(raw);
    }

    const requestFiles = await listJsonFiles(path.join(sessionDir, 'compaction_requests'));
    const archivedHistories = (
        await Promise.all(
            requestFiles.map(async (filePath) => {
                const request = await readJsonObjectFile(filePath);
                return {
                    createdAtMs: parseTimestampMs(request?.created_at) ?? 0,
                    events: getJsonObjectList(request?.chat_history),
                    filePath,
                };
            }),
        )
    )
        .filter((history) => history.events.length > 0)
        .sort((left, right) => left.createdAtMs - right.createdAtMs || left.filePath.localeCompare(right.filePath));

    if (archivedHistories.length === 0) {
        return liveEvents;
    }

    const checkpointFiles = await listJsonFiles(path.join(sessionDir, 'compaction_checkpoints'));
    const checkpoints = (
        await Promise.all(
            checkpointFiles.map(async (filePath) => {
                const checkpoint = await readJsonObjectFile(filePath);
                return {
                    compactedHistory: getJsonObjectList(checkpoint?.compacted_history),
                    createdAtMs: parseTimestampMs(checkpoint?.created_at) ?? 0,
                    filePath,
                    promptIndex: asNumber(checkpoint?.prompt_index_at_compaction ?? null),
                };
            }),
        )
    ).sort((left, right) => left.createdAtMs - right.createdAtMs || left.filePath.localeCompare(right.filePath));

    const isHistoryPrefix = (prefix: Record<string, JsonValue>[], history: Record<string, JsonValue>[]): boolean => {
        return (
            prefix.length > 0 &&
            prefix.length <= history.length &&
            prefix.every((event, index) => JSON.stringify(event) === JSON.stringify(history[index]))
        );
    };

    let archivedHistory = [...archivedHistories[0]!.events];
    for (const history of archivedHistories.slice(1)) {
        const precedingCheckpoint = checkpoints
            .filter(
                (checkpoint) =>
                    checkpoint.createdAtMs <= history.createdAtMs &&
                    isHistoryPrefix(checkpoint.compactedHistory, history.events),
            )
            .at(-1);
        if (precedingCheckpoint) {
            archivedHistory.push(...history.events.slice(precedingCheckpoint.compactedHistory.length));
        } else if (isHistoryPrefix(archivedHistory, history.events)) {
            archivedHistory = [...history.events];
        }
    }

    const latestCheckpoint = checkpoints.at(-1);

    const compactedHistoryIsLivePrefix = isHistoryPrefix(latestCheckpoint?.compactedHistory ?? [], liveEvents);
    const archivedHistoryIsLivePrefix = isHistoryPrefix(archivedHistory, liveEvents);
    const liveTailStart = compactedHistoryIsLivePrefix
        ? latestCheckpoint?.compactedHistory.length
        : archivedHistoryIsLivePrefix
          ? archivedHistory.length
          : latestCheckpoint?.promptIndex;
    const liveTail = Number.isFinite(liveTailStart)
        ? liveEvents.slice(Math.max(0, Math.min(liveEvents.length, Math.floor(liveTailStart ?? 0))))
        : liveEvents;
    return [...archivedHistory, ...liveTail];
};

const createEmptyStats = (): SessionStats => ({
    assistantMessageCount: 0,
    messageCount: 0,
    reasoningCount: 0,
    renderablePartCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    userMessageCount: 0,
});

const isRenderablePart = (part: GrokTranscriptPart): boolean => {
    if (part.type === 'text' || part.type === 'reasoning') {
        return Boolean(part.text?.trim());
    }

    if (part.type === 'tool_call') {
        return Boolean(part.toolName || part.argumentsText?.trim());
    }

    if (part.type === 'tool_result') {
        return Boolean(part.outputText?.trim());
    }

    return false;
};

const updateStatsFromEntry = (stats: SessionStats, entry: GrokTranscriptEntry) => {
    if (entry.role === 'assistant' || entry.role === 'user') {
        stats.messageCount += entry.parts.some((part) => part.type === 'text') ? 1 : 0;
    }

    if (entry.role === 'assistant' && entry.parts.some((part) => part.type === 'text')) {
        stats.assistantMessageCount += 1;
    }

    if (entry.role === 'user' && entry.parts.some((part) => part.type === 'text')) {
        stats.userMessageCount += 1;
    }

    stats.reasoningCount += entry.parts.filter((part) => part.type === 'reasoning').length;
    stats.toolCallCount += entry.parts.filter((part) => part.type === 'tool_call').length;
    stats.toolResultCount += entry.parts.filter((part) => part.type === 'tool_result').length;
    stats.renderablePartCount += entry.parts.filter(isRenderablePart).length;
};

const getStringList = (value: JsonValue | undefined): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((item) => {
        const stringValue = asString(item);
        return stringValue ? [stringValue] : [];
    });
};

const getSummaryCwd = (summary: Record<string, JsonValue>, info: Record<string, JsonValue> | null): string | null => {
    return asString(info?.cwd ?? null) ?? asString(summary.cwd ?? null);
};

const getSummaryMessageCount = (summary: Record<string, JsonValue>): number | null => {
    return typeof summary.num_chat_messages === 'number' ? summary.num_chat_messages : null;
};

const getSummarySessionId = (
    summary: Record<string, JsonValue>,
    info: Record<string, JsonValue> | null,
): string | null => {
    return asString(info?.id ?? null) ?? asString(summary.id ?? null);
};

const getSummaryTitle = (summary: Record<string, JsonValue>): string | null => {
    return cleanLabel(asString(summary.generated_title ?? null) ?? asString(summary.session_summary ?? null));
};

const readSummaryIdentity = async (summaryPath: string): Promise<SummaryIdentity | null> => {
    const summary = await readJsonObjectFile(summaryPath);
    if (!summary) {
        return null;
    }

    const info = asObject(summary.info ?? null);

    return {
        agentName: asString(summary.agent_name ?? null),
        createdAtMs: parseTimestampMs(summary.created_at),
        currentModelId: asString(summary.current_model_id ?? null),
        cwd: getSummaryCwd(summary, info),
        gitBranch: asString(summary.head_branch ?? null),
        gitRemotes: getStringList(summary.git_remotes),
        gitRootDir: asString(summary.git_root_dir ?? null),
        headCommit: asString(summary.head_commit ?? null),
        lastActiveAtMs: parseTimestampMs(summary.last_active_at) ?? parseTimestampMs(summary.updated_at),
        messageCount: getSummaryMessageCount(summary),
        sandboxProfile: asString(summary.sandbox_profile ?? null),
        sessionId: getSummarySessionId(summary, info),
        title: getSummaryTitle(summary),
    };
};

const readModelLabels = async (grokHome: string): Promise<Map<string, string>> => {
    const raw = await readJsonObjectFile(path.join(grokHome, 'models_cache.json'));
    const models = asObject(raw?.models ?? null);
    const labels = new Map<string, string>();
    if (!models) {
        return labels;
    }

    for (const [modelId, modelValue] of Object.entries(models)) {
        const info = asObject(asObject(modelValue)?.info ?? null);
        const label = cleanLabel(asString(info?.name ?? null));
        if (label) {
            labels.set(modelId, label);
        }
    }

    return labels;
};

const getFirstUserText = (entries: GrokTranscriptEntry[]): string | null => {
    const userEntry = entries.find((entry) => entry.role === 'user');
    const textPart = userEntry?.parts.find((part) => part.type === 'text' && part.text?.trim());
    return cleanExtractedText(textPart?.text ?? '').trim() || null;
};

const toSessionSummary = (
    file: GrokSessionDirectory,
    identity: SummaryIdentity,
    stats: SessionStats,
    entries: GrokTranscriptEntry[],
    modelLabels: Map<string, string>,
): GrokSessionSummary => {
    const sessionId = identity.sessionId ?? path.basename(file.sessionDir);
    const worktree = identity.cwd ?? decodeWorkspaceDirectoryName(file.directoryName);
    const title = cleanInlineTitle(identity.title ?? getFirstUserText(entries) ?? sessionId);
    const currentModelId = identity.currentModelId ?? entries.find((entry) => entry.modelId)?.modelId ?? null;
    const updatedAtMs = identity.lastActiveAtMs;
    const chatHistoryPath = path.join(file.sessionDir, 'chat_history.jsonl');
    const updatesPath = path.join(file.sessionDir, 'updates.jsonl');

    return {
        ...stats,
        agentName: identity.agentName,
        chatHistoryPath,
        chatMessageCount: identity.messageCount ?? stats.messageCount,
        createdAtIso: toIso(identity.createdAtMs),
        createdAtMs: identity.createdAtMs,
        currentModelId,
        cwd: identity.cwd,
        gitBranch: identity.gitBranch,
        gitRemotes: identity.gitRemotes,
        gitRootDir: identity.gitRootDir,
        headCommit: identity.headCommit,
        lastActiveAtIso: toIso(updatedAtMs),
        lastActiveAtMs: updatedAtMs,
        messageCount: stats.messageCount,
        modelLabel: currentModelId ? (modelLabels.get(currentModelId) ?? null) : null,
        sandboxProfile: identity.sandboxProfile,
        sessionDir: file.sessionDir,
        sessionId,
        summaryPath: path.join(file.sessionDir, 'summary.json'),
        title,
        updatesPath,
        workspaceKey: getWorkspaceKey(file.directoryName),
        workspaceLabel: getWorkspaceLabel(worktree),
        worktree,
    };
};

const readSessionDirectory = async (
    file: GrokSessionDirectory,
    modelLabels: Map<string, string>,
    options: ReadGrokSessionTranscriptOptions = {},
): Promise<GrokSessionTranscript | null> => {
    const includeRawPayloads = options.includeRawPayloads ?? true;
    const summaryPath = path.join(file.sessionDir, 'summary.json');
    const chatHistoryPath = path.join(file.sessionDir, 'chat_history.jsonl');
    const identity = await readSummaryIdentity(summaryPath);
    if (!identity || !(await pathExists(chatHistoryPath))) {
        return null;
    }

    const sessionId = identity.sessionId ?? path.basename(file.sessionDir);
    const stats = createEmptyStats();
    const entries: GrokTranscriptEntry[] = [];
    const rawEvents: Record<string, JsonValue>[] = [];
    let index = 0;

    for (const raw of await readGrokChatHistory(file.sessionDir, chatHistoryPath)) {
        if (includeRawPayloads) {
            rawEvents.push(raw);
        }
        const entry = parseTranscriptEntry(raw, sessionId, index, includeRawPayloads);
        index += 1;
        if (!entry) {
            continue;
        }

        entries.push(entry);
        updateStatsFromEntry(stats, entry);
    }

    return {
        entries,
        rawEvents,
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
        renderablePartCount: stats.renderablePartCount,
        session: toSessionSummary(file, identity, stats, entries, modelLabels),
    };
};

const listSessionDirectoriesForWorkspace = async (
    sessionsDir: string,
    directoryName: string,
): Promise<GrokSessionDirectory[]> => {
    const workspaceDir = path.join(sessionsDir, directoryName);
    return listSessionDirectoriesUnderWorkspace(workspaceDir, directoryName);
};

const listSessionDirectoriesUnderWorkspace = async (
    root: string,
    directoryName: string,
): Promise<GrokSessionDirectory[]> => {
    const entries = await readDirectoryEntriesIfExists(root);
    const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const isSessionDirectory = fileNames.has('summary.json') && fileNames.has('chat_history.jsonl');
    const childDirectories = entries.filter(
        (entry) => entry.isDirectory() && (!isSessionDirectory || entry.name === 'subagents'),
    );
    const nested = await mapWithConcurrency(childDirectories, READ_CONCURRENCY, (entry) =>
        listSessionDirectoriesUnderWorkspace(path.join(root, entry.name), directoryName),
    );
    const directories: GrokSessionDirectory[] = isSessionDirectory ? [{ directoryName, sessionDir: root }] : [];
    directories.push(...nested.flat());

    return directories.sort((left, right) => left.sessionDir.localeCompare(right.sessionDir));
};

const listSessionDirectories = async (sessionsDir: string): Promise<GrokSessionDirectory[]> => {
    if (!(await pathExists(sessionsDir))) {
        return [];
    }

    const workspaceDirs = (await readdir(sessionsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const groupedFiles = await mapWithConcurrency(workspaceDirs, READ_CONCURRENCY, (directoryName) =>
        listSessionDirectoriesForWorkspace(sessionsDir, directoryName),
    );
    return groupedFiles.flat();
};

const readSessionDirectories = async (
    sessionsDir: string,
    files: GrokSessionDirectory[],
): Promise<GrokSessionTranscript[]> => {
    const modelLabels = await readModelLabels(getGrokHomeFromSessionsDir(sessionsDir));
    const transcripts = await mapWithConcurrency(files, READ_CONCURRENCY, (file) =>
        readSessionDirectory(file, modelLabels),
    );
    return transcripts.flatMap((transcript) => (transcript ? [transcript] : []));
};

const hasConversationMessages = (transcript: GrokSessionTranscript): boolean => {
    return transcript.session.userMessageCount > 0 || transcript.session.assistantMessageCount > 0;
};

const compareNullableMsDesc = (left: number | null, right: number | null): number => {
    return (right ?? 0) - (left ?? 0);
};

const sumSessions = (sessions: GrokSessionSummary[], key: keyof SessionStats): number => {
    return sessions.reduce((total, session) => total + session[key], 0);
};

const toWorkspaceGroup = (directoryName: string, sessions: GrokSessionSummary[]): GrokWorkspaceGroup => {
    const worktree = sessions[0]?.worktree ?? decodeWorkspaceDirectoryName(directoryName);
    const lastActiveAtMs = sessions.reduce<number | null>((latest, session) => {
        if (session.lastActiveAtMs === null) {
            return latest;
        }

        return latest === null ? session.lastActiveAtMs : Math.max(latest, session.lastActiveAtMs);
    }, null);

    return {
        assistantMessageCount: sumSessions(sessions, 'assistantMessageCount'),
        chatMessageCount: sessions.reduce((total, session) => total + session.chatMessageCount, 0),
        directoryName,
        key: getWorkspaceKey(directoryName),
        label: getWorkspaceLabel(worktree),
        lastActiveAtIso: toIso(lastActiveAtMs),
        lastActiveAtMs,
        messageCount: sessions.reduce((total, session) => total + session.messageCount, 0),
        reasoningCount: sumSessions(sessions, 'reasoningCount'),
        sessionCount: sessions.length,
        toolCallCount: sumSessions(sessions, 'toolCallCount'),
        toolResultCount: sumSessions(sessions, 'toolResultCount'),
        uri: getWorkspaceUri(worktree),
        userMessageCount: sumSessions(sessions, 'userMessageCount'),
        worktree,
    };
};

export const listGrokWorkspaceGroups = async (
    sessionsDir = resolveGrokSessionsDir(),
): Promise<GrokWorkspaceGroup[]> => {
    const files = await listSessionDirectories(sessionsDir);
    const transcripts = await readSessionDirectories(sessionsDir, files);
    const sessionsByDirectory = new Map<string, GrokSessionSummary[]>();

    for (const transcript of transcripts) {
        if (!hasConversationMessages(transcript)) {
            continue;
        }

        const directoryName = getDirectoryNameFromWorkspaceKey(transcript.session.workspaceKey);
        if (!directoryName) {
            continue;
        }

        const sessions = sessionsByDirectory.get(directoryName) ?? [];
        sessions.push(transcript.session);
        sessionsByDirectory.set(directoryName, sessions);
    }

    return [...sessionsByDirectory.entries()]
        .map(([directoryName, sessions]) => toWorkspaceGroup(directoryName, sessions))
        .sort(
            (left, right) =>
                compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) ||
                left.worktree.localeCompare(right.worktree),
        );
};

const grokWorkspaceMatchesQuery = (workspace: GrokWorkspaceGroup, query: string): boolean => {
    const raw = query.trim();
    if (!raw) {
        return true;
    }

    const lowered = raw.toLowerCase();
    if (
        workspace.key.toLowerCase() === lowered ||
        workspace.directoryName.toLowerCase() === lowered ||
        workspace.label.toLowerCase() === lowered
    ) {
        return true;
    }

    if (isWorkspacePathQuery(raw)) {
        return workspacePathMatchesQuery(workspace.worktree, raw);
    }

    return getPortablePathBasename(workspace.worktree).toLowerCase() === lowered;
};

export const findGrokWorkspaceGroups = (groups: GrokWorkspaceGroup[], query: string): GrokWorkspaceGroup[] => {
    return groups.filter((group) => grokWorkspaceMatchesQuery(group, query));
};

const sortSessions = (sessions: GrokSessionSummary[]): GrokSessionSummary[] => {
    return [...sessions].sort(
        (left, right) =>
            compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) || left.title.localeCompare(right.title),
    );
};

export const listGrokSessionsForGroup = async (
    workspaceKey: string,
    sessionsDir = resolveGrokSessionsDir(),
): Promise<GrokSessionSummary[]> => {
    const transcripts = await listGrokSessionTranscriptsForGroup(workspaceKey, sessionsDir);
    return sortSessions(transcripts.map((transcript) => transcript.session));
};

export const listGrokSessionTranscriptsForGroup = async (
    workspaceKey: string,
    sessionsDir = resolveGrokSessionsDir(),
): Promise<GrokSessionTranscript[]> => {
    const directoryName = getDirectoryNameFromWorkspaceKey(workspaceKey);
    if (!directoryName || !(await pathExists(sessionsDir))) {
        return [];
    }

    const files = await listSessionDirectoriesForWorkspace(sessionsDir, directoryName);
    const transcripts = await readSessionDirectories(sessionsDir, files);
    return transcripts
        .filter(hasConversationMessages)
        .sort(
            (left, right) =>
                compareNullableMsDesc(left.session.lastActiveAtMs, right.session.lastActiveAtMs) ||
                left.session.title.localeCompare(right.session.title),
        );
};

const locateSessionDirectory = async (sessionsDir: string, sessionId: string): Promise<GrokSessionDirectory | null> => {
    const files = await listSessionDirectories(sessionsDir);
    const directMatch = files.find((file) => path.basename(file.sessionDir) === sessionId);
    if (directMatch) {
        return directMatch;
    }

    const modelLabels = await readModelLabels(getGrokHomeFromSessionsDir(sessionsDir));
    const located = await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
        const transcript = await readSessionDirectory(file, modelLabels);
        return transcript?.session.sessionId === sessionId ? file : null;
    });
    return located.find((file) => file !== null) ?? null;
};

const listFilesRecursively = async (root: string): Promise<string[]> => {
    const entries = await readDirectoryEntriesIfExists(root);
    const files: string[] = [];

    for (const entry of entries) {
        const entryPath = path.join(root, entry.name);
        if (entry.isFile()) {
            files.push(entryPath);
            continue;
        }

        if (entry.isDirectory()) {
            files.push(...(await listFilesRecursively(entryPath)));
        }
    }

    return files;
};

const listDirectoriesRecursively = async (root: string): Promise<string[]> => {
    const entries = await readDirectoryEntriesIfExists(root);
    const directories: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const entryPath = path.join(root, entry.name);
        directories.push(entryPath, ...(await listDirectoriesRecursively(entryPath)));
    }

    return directories;
};

const listRelatedSubagentDirectories = async (sessionsDir: string, sessionId: string): Promise<string[]> => {
    const candidates = (await listDirectoriesRecursively(sessionsDir)).filter(
        (directoryPath) =>
            path.basename(directoryPath) === sessionId && path.basename(path.dirname(directoryPath)) === 'subagents',
    );
    const related = await mapWithConcurrency(candidates, READ_CONCURRENCY, async (directoryPath) => {
        const metadata = await readJsonObjectFile(path.join(directoryPath, 'meta.json'));
        return asString(metadata?.child_session_id ?? null) === sessionId ? directoryPath : null;
    });
    return related.filter((directoryPath): directoryPath is string => directoryPath !== null);
};

const pruneReportedTaskCompletion = (value: JsonValue, sessionId: string): boolean => {
    const root = asObject(value);
    const state = asObject(root?.state ?? null);
    const completions = asObject(state?.['grok_build.ReportedTaskCompletions'] ?? null);
    const reported = completions?.reported;
    if (!completions || !Array.isArray(reported)) {
        return false;
    }

    const next = reported.filter((entry) => entry !== sessionId);
    if (next.length === reported.length) {
        return false;
    }

    completions.reported = next;
    return true;
};

const writeGrokJsonFile = async (filePath: string, value: JsonValue): Promise<void> => {
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    const mode = (await stat(filePath)).mode & 0o777;
    try {
        await Bun.write(tempPath, `${JSON.stringify(value, null, 2)}\n`);
        await chmod(tempPath, mode);
        await rename(tempPath, filePath);
    } finally {
        await rm(tempPath, { force: true });
    }
};

const pruneResourcesStateReferences = async (sessionsDir: string, sessionId: string): Promise<void> => {
    const resourceStatePaths = (await listFilesRecursively(sessionsDir)).filter(
        (filePath) => path.basename(filePath) === 'resources_state.json',
    );

    for (const resourceStatePath of resourceStatePaths) {
        const value = (await Bun.file(resourceStatePath)
            .json()
            .catch(() => null)) as JsonValue | null;
        if (value === null) {
            continue;
        }

        if (pruneReportedTaskCompletion(value, sessionId)) {
            await writeGrokJsonFile(resourceStatePath, value);
        }
    }
};

const removeActiveSessionEntry = async (sessionsDir: string, sessionId: string): Promise<void> => {
    const activeSessionsPath = path.join(getGrokHomeFromSessionsDir(sessionsDir), 'active_sessions.json');
    const file = Bun.file(activeSessionsPath);
    if (!(await file.exists())) {
        return;
    }

    const value = (await file.json().catch(() => null)) as JsonValue | null;
    if (!Array.isArray(value)) {
        console.warn('[spiracha:grok-db] malformed_active_sessions', { path: activeSessionsPath });
        return;
    }

    const next = value.filter((item) => asString(asObject(item)?.session_id ?? null) !== sessionId);
    if (next.length === value.length) {
        return;
    }

    await writeGrokJsonFile(activeSessionsPath, next);
};

export const readGrokSessionTranscript = async (
    sessionsDir: string,
    sessionId: string,
    options: ReadGrokSessionTranscriptOptions = {},
): Promise<GrokSessionTranscript | null> => {
    if (!(await pathExists(sessionsDir))) {
        return null;
    }

    const file = await locateSessionDirectory(sessionsDir, sessionId);
    if (!file) {
        return null;
    }

    const modelLabels = await readModelLabels(getGrokHomeFromSessionsDir(sessionsDir));
    return readSessionDirectory(file, modelLabels, options);
};

const isSafeGrokSessionId = (sessionId: string): boolean =>
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(sessionId) && !sessionId.includes('..');

const deleteGrokSessionWithLimit = async (sessionsDir: string, sessionId: string): Promise<DeleteGrokSessionResult> => {
    if (!isSafeGrokSessionId(sessionId)) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    if (!(await pathExists(sessionsDir))) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const directMatches = (await listSessionDirectories(sessionsDir)).filter(
        (file) => path.basename(file.sessionDir) === sessionId,
    );
    const directories =
        directMatches.length > 0
            ? directMatches
            : await locateSessionDirectory(sessionsDir, sessionId).then((file) => (file ? [file] : []));
    const uniqueSessionDirs = [...new Set(directories.map((file) => file.sessionDir))];
    const relatedSubagentDirs = await listRelatedSubagentDirectories(sessionsDir, sessionId);
    const deleteDirs = [...new Set([...uniqueSessionDirs, ...relatedSubagentDirs])];
    if (deleteDirs.length === 0) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const deletedFiles = (
        await Promise.all(
            deleteDirs.map(async (directoryPath) => {
                const files = await listFilesRecursively(directoryPath);
                await rm(directoryPath, { force: true, recursive: true });
                return files;
            }),
        )
    ).flat();
    await removeActiveSessionEntry(sessionsDir, sessionId);
    await pruneResourcesStateReferences(sessionsDir, sessionId);
    return {
        deletedFiles,
        deletedSessionIds: [sessionId],
    };
};

export const deleteGrokSession = async (sessionsDir: string, sessionId: string): Promise<DeleteGrokSessionResult> => {
    return grokDeleteLimiter(() => deleteGrokSessionWithLimit(sessionsDir, sessionId));
};
