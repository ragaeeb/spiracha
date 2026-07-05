import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { mapWithConcurrency } from './concurrency';
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
import {
    asObject,
    asString,
    cleanExtractedText,
    cleanInlineTitle,
    getPortablePathBasename,
    isWorkspacePathQuery,
    type JsonValue,
    readJsonlObjects,
    workspacePathMatchesQuery,
} from './shared';

export { getDefaultGrokHome, resolveGrokHome, resolveGrokSessionsDir };

const READ_CONCURRENCY = 8;
const WORKSPACE_KEY_PREFIX = 'workspace:';

type GrokSessionDirectory = {
    directoryName: string;
    sessionDir: string;
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
): GrokTranscriptPart | null => {
    const toolName = asString(raw.name ?? null) ?? 'unknown';
    const argumentsText = formatJsonLike(raw.arguments);
    return {
        argumentsText,
        partId: `${entryId}:tool-call:${index}`,
        raw,
        toolCallId: asString(raw.id ?? null),
        toolName,
        type: 'tool_call',
    };
};

const parseAssistantParts = (raw: Record<string, JsonValue>, entryId: string): GrokTranscriptPart[] => {
    const parts: GrokTranscriptPart[] = [];
    const text = asString(raw.content ?? null) ?? '';
    if (text.trim()) {
        parts.push({
            partId: `${entryId}:text`,
            raw: { content: text },
            text,
            type: 'text',
        });
    }

    const toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
    toolCalls.forEach((item, index) => {
        const object = asObject(item);
        const part = object ? parseToolCallPart(object, entryId, index) : null;
        if (part) {
            parts.push(part);
        }
    });

    return parts;
};

const parseTextEntryPart = (raw: Record<string, JsonValue>, entryId: string): GrokTranscriptPart[] => {
    const text = textFromContentValue(raw.content).trim();
    return text
        ? [
              {
                  partId: `${entryId}:text`,
                  raw,
                  text,
                  type: 'text',
              },
          ]
        : [];
};

const parseReasoningParts = (raw: Record<string, JsonValue>, entryId: string): GrokTranscriptPart[] => {
    const text = getReasoningText(raw).trim();
    return text
        ? [
              {
                  partId: `${entryId}:reasoning`,
                  raw,
                  text,
                  type: 'reasoning',
              },
          ]
        : [];
};

const parseToolResultParts = (raw: Record<string, JsonValue>, entryId: string): GrokTranscriptPart[] => {
    const outputText = textFromContentValue(raw.content).trim();
    return outputText
        ? [
              {
                  outputText,
                  partId: `${entryId}:tool-result`,
                  raw,
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

const parseTranscriptEntry = (
    raw: Record<string, JsonValue>,
    sessionId: string,
    index: number,
): GrokTranscriptEntry | null => {
    const type = asString(raw.type ?? null) ?? 'unknown';
    const entryId = asString(raw.id ?? null) ?? `${sessionId}:${index}`;
    const parts =
        type === 'assistant'
            ? parseAssistantParts(raw, entryId)
            : type === 'reasoning'
              ? parseReasoningParts(raw, entryId)
              : type === 'tool_result'
                ? parseToolResultParts(raw, entryId)
                : parseTextEntryPart(raw, entryId);

    if (parts.length === 0) {
        return null;
    }

    return {
        createdAtMs: null,
        entryId,
        modelFingerprint: asString(raw.model_fingerprint ?? null),
        modelId: asString(raw.model_id ?? null),
        parts,
        raw,
        role: getEntryRole(type),
        timestamp: null,
        type,
    };
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
    if (entry.role === 'assistant' || entry.role === 'system' || entry.role === 'user') {
        stats.messageCount += entry.parts.some((part) => part.type === 'text') ? 1 : 0;
    }

    if (entry.role === 'assistant' && entry.parts.some((part) => part.type === 'text')) {
        stats.assistantMessageCount += 1;
    }

    if (entry.role === 'user') {
        stats.userMessageCount += 1;
    }

    stats.reasoningCount += entry.parts.filter((part) => part.type === 'reasoning').length;
    stats.toolCallCount += entry.parts.filter((part) => part.type === 'tool_call').length;
    stats.toolResultCount += entry.parts.filter((part) => part.type === 'tool_result').length;
    stats.renderablePartCount += entry.parts.filter(isRenderablePart).length;
};

const readJsonObjectFile = async (filePath: string): Promise<Record<string, JsonValue> | null> => {
    const raw = (await Bun.file(filePath)
        .json()
        .catch(() => null)) as JsonValue | null;
    return asObject(raw);
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
        messageCount: identity.messageCount ?? stats.messageCount,
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
): Promise<GrokSessionTranscript | null> => {
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

    for await (const raw of readJsonlObjects(chatHistoryPath)) {
        rawEvents.push(raw);
        const entry = parseTranscriptEntry(raw, sessionId, index);
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
        renderablePartCount: stats.renderablePartCount,
        session: toSessionSummary(file, identity, stats, entries, modelLabels),
    };
};

const listSessionDirectoriesForWorkspace = async (
    sessionsDir: string,
    directoryName: string,
): Promise<GrokSessionDirectory[]> => {
    const workspaceDir = path.join(sessionsDir, directoryName);
    const entries = await readdir(workspaceDir, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
            directoryName,
            sessionDir: path.join(workspaceDir, entry.name),
        }))
        .sort((left, right) => left.sessionDir.localeCompare(right.sessionDir));
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
    const directoryName = getDirectoryNameFromWorkspaceKey(workspaceKey);
    if (!directoryName || !(await pathExists(sessionsDir))) {
        return [];
    }

    const files = await listSessionDirectoriesForWorkspace(sessionsDir, directoryName);
    const transcripts = await readSessionDirectories(sessionsDir, files);
    return sortSessions(transcripts.map((transcript) => transcript.session));
};

const locateSessionDirectory = async (sessionsDir: string, sessionId: string): Promise<GrokSessionDirectory | null> => {
    const files = await listSessionDirectories(sessionsDir);
    const modelLabels = await readModelLabels(getGrokHomeFromSessionsDir(sessionsDir));
    const located = await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
        const transcript = await readSessionDirectory(file, modelLabels);
        return transcript?.session.sessionId === sessionId ? file : null;
    });
    return located.find((file) => file !== null) ?? null;
};

const listFilesRecursively = async (root: string): Promise<string[]> => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
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

const removeActiveSessionEntry = async (sessionsDir: string, sessionId: string): Promise<void> => {
    const activeSessionsPath = path.join(getGrokHomeFromSessionsDir(sessionsDir), 'active_sessions.json');
    const value = (await Bun.file(activeSessionsPath)
        .json()
        .catch(() => null)) as JsonValue | null;
    if (!Array.isArray(value)) {
        return;
    }

    const next = value.filter((item) => asString(asObject(item)?.session_id ?? null) !== sessionId);
    if (next.length === value.length) {
        return;
    }

    await Bun.write(activeSessionsPath, `${JSON.stringify(next, null, 2)}\n`);
};

export const readGrokSessionTranscript = async (
    sessionsDir: string,
    sessionId: string,
): Promise<GrokSessionTranscript | null> => {
    if (!(await pathExists(sessionsDir))) {
        return null;
    }

    const file = await locateSessionDirectory(sessionsDir, sessionId);
    if (!file) {
        return null;
    }

    const modelLabels = await readModelLabels(getGrokHomeFromSessionsDir(sessionsDir));
    return readSessionDirectory(file, modelLabels);
};

export const deleteGrokSession = async (sessionsDir: string, sessionId: string): Promise<DeleteGrokSessionResult> => {
    if (!(await pathExists(sessionsDir))) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const file = await locateSessionDirectory(sessionsDir, sessionId);
    if (!file) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const deletedFiles = await listFilesRecursively(file.sessionDir);
    await rm(file.sessionDir, { force: true, recursive: true });
    await removeActiveSessionEntry(sessionsDir, sessionId);
    return {
        deletedFiles,
        deletedSessionIds: [sessionId],
    };
};
