import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
    type ClaudeCodeSessionSummary,
    type ClaudeCodeSessionTranscript,
    type ClaudeCodeTranscriptEntry,
    type ClaudeCodeTranscriptPart,
    type ClaudeCodeWorkspaceGroup,
    getDefaultClaudeCodeDataDir,
    resolveClaudeCodeProjectsDir,
} from './claude-code-exporter-types';
import { mapWithConcurrency } from './concurrency';
import {
    asBoolean,
    asNumber,
    asObject,
    asString,
    cleanExtractedText,
    cleanInlineTitle,
    expandHome,
    getPortablePathBasename,
    type JsonValue,
    readJsonlObjects,
} from './shared';

export { getDefaultClaudeCodeDataDir, resolveClaudeCodeProjectsDir };

const READ_CONCURRENCY = 8;
const WORKSPACE_KEY_PREFIX = 'project:';

type TranscriptFile = {
    directoryName: string;
    filePath: string;
};

type ParsedTranscriptFile = {
    transcript: ClaudeCodeSessionTranscript;
};

type SessionStats = {
    assistantMessageCount: number;
    attachmentCount: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    inputTokens: number;
    messageCount: number;
    outputTokens: number;
    toolCallCount: number;
    toolResultCount: number;
    userMessageCount: number;
};

type SessionIdentity = {
    cwd: string | null;
    firstUserText: string | null;
    gitBranch: string | null;
    model: string | null;
    sessionId: string;
    title: string | null;
    version: string | null;
};

type SessionTimeline = {
    createdAtIso: string | null;
    createdAtMs: number | null;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
};

const pathExists = async (target: string): Promise<boolean> => {
    return await stat(target)
        .then(() => true)
        .catch(() => false);
};

const cleanLabel = (value: string | null | undefined): string | null => {
    const cleaned = value?.replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned : null;
};

const getWorkspaceKey = (directoryName: string): string => `${WORKSPACE_KEY_PREFIX}${directoryName}`;

const getDirectoryNameFromWorkspaceKey = (workspaceKey: string): string | null => {
    return workspaceKey.startsWith(WORKSPACE_KEY_PREFIX) ? workspaceKey.slice(WORKSPACE_KEY_PREFIX.length) : null;
};

const decodeWorktreeFromDirectoryName = (directoryName: string): string => {
    if (!directoryName.startsWith('-')) {
        return directoryName.replace(/-/g, path.sep);
    }

    return path.join(path.sep, ...directoryName.slice(1).split('-').filter(Boolean));
};

const getWorkspaceLabel = (worktree: string): string => {
    if (worktree === path.sep) {
        return '(global)';
    }

    return getPortablePathBasename(worktree) || worktree;
};

const getWorkspaceUri = (worktree: string): string => {
    return worktree.startsWith(path.sep) ? `file://${worktree}` : worktree;
};

const toIso = (value: number | null): string | null => {
    return value === null ? null : new Date(value).toISOString();
};

const parseTimestampMs = (value: JsonValue | undefined): number | null => {
    const timestamp = asString(value ?? null);
    if (!timestamp) {
        return null;
    }

    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
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
                return asString(object?.text ?? null) ?? '';
            })
            .filter(Boolean)
            .join('\n\n');
    }

    const object = asObject(value ?? null);
    return asString(object?.text ?? null) ?? '';
};

const parseTextContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => ({
    raw: item,
    text: asString(item.text ?? null) ?? '',
    type: 'text',
});

const parseThinkingContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => ({
    raw: item,
    text: asString(item.thinking ?? null) ?? '',
    type: 'thinking',
});

const parseToolUseContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => ({
    argumentsText: formatJsonLike(item.input),
    raw: item,
    toolName: asString(item.name ?? null) ?? 'unknown',
    toolUseId: asString(item.id ?? null),
    type: 'tool_use',
});

const parseToolResultContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => ({
    isError: asBoolean(item.is_error ?? null),
    outputText: cleanExtractedText(textFromContentValue(item.content)).trim(),
    raw: item,
    toolUseId: asString(item.tool_use_id ?? null),
    type: 'tool_result',
});

const parseFallbackContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => {
    const fallbackText = asString(item.text ?? null);
    return {
        raw: item,
        text: fallbackText ?? undefined,
        type: fallbackText ? 'text' : 'unknown',
    };
};

const structuredContentParsers: Record<string, (item: Record<string, JsonValue>) => ClaudeCodeTranscriptPart> = {
    input_text: parseTextContentPart,
    output_text: parseTextContentPart,
    text: parseTextContentPart,
    thinking: parseThinkingContentPart,
    tool_result: parseToolResultContentPart,
    tool_use: parseToolUseContentPart,
};

const parseStructuredContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => {
    const type = asString(item.type ?? null);
    return type
        ? (structuredContentParsers[type]?.(item) ?? parseFallbackContentPart(item))
        : parseFallbackContentPart(item);
};

const parseMessageContentPart = (item: JsonValue): ClaudeCodeTranscriptPart | null => {
    if (typeof item === 'string') {
        return {
            raw: { text: item },
            text: item,
            type: 'text',
        };
    }

    const object = asObject(item);
    return object ? parseStructuredContentPart(object) : null;
};

const parseMessageParts = (message: Record<string, JsonValue>): ClaudeCodeTranscriptPart[] => {
    const content = message.content;
    const items = Array.isArray(content) ? content : [content];
    return items
        .map(parseMessageContentPart)
        .filter((part): part is ClaudeCodeTranscriptPart => part !== null && part.type !== 'unknown');
};

const parseAttachmentParts = (raw: Record<string, JsonValue>): ClaudeCodeTranscriptPart[] => {
    const attachment = asObject(raw.attachment ?? null);
    if (!attachment) {
        return [];
    }

    return [
        {
            attachmentType: asString(attachment.type ?? null),
            raw: attachment,
            text: textFromContentValue(attachment.content),
            type: 'attachment',
        },
    ];
};

const getTranscriptEntryParts = (
    type: string,
    message: Record<string, JsonValue> | null,
    raw: Record<string, JsonValue>,
): ClaudeCodeTranscriptPart[] => {
    if (message) {
        return parseMessageParts(message);
    }

    if (type === 'attachment') {
        return parseAttachmentParts(raw);
    }

    return [];
};

const getTranscriptEntryRole = (type: string, message: Record<string, JsonValue> | null): string => {
    return asString(message?.role ?? null) ?? (type === 'attachment' ? 'attachment' : type);
};

const getTranscriptEntryId = (type: string, raw: Record<string, JsonValue>): string => {
    return asString(raw.uuid ?? null) ?? `${type}:${asString(raw.sessionId ?? null) ?? 'unknown'}`;
};

const parseTranscriptEntry = (raw: Record<string, JsonValue>): ClaudeCodeTranscriptEntry | null => {
    const type = asString(raw.type ?? null) ?? 'unknown';
    const message = asObject(raw.message ?? null);
    const parts = getTranscriptEntryParts(type, message, raw);

    if (parts.length === 0) {
        return null;
    }

    return {
        cwd: asString(raw.cwd ?? null),
        entryId: getTranscriptEntryId(type, raw),
        model: asString(message?.model ?? null),
        parentEntryId: asString(raw.parentUuid ?? null),
        parts,
        raw,
        role: getTranscriptEntryRole(type, message),
        timestamp: asString(raw.timestamp ?? null),
        type,
    };
};

const createEmptyStats = (): SessionStats => ({
    assistantMessageCount: 0,
    attachmentCount: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    inputTokens: 0,
    messageCount: 0,
    outputTokens: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    userMessageCount: 0,
});

const addUsageStats = (stats: SessionStats, message: Record<string, JsonValue> | null) => {
    const usage = asObject(message?.usage ?? null);
    if (!usage) {
        return;
    }

    stats.inputTokens += asNumber(usage.input_tokens ?? null) ?? 0;
    stats.outputTokens += asNumber(usage.output_tokens ?? null) ?? 0;
    stats.cacheCreationInputTokens += asNumber(usage.cache_creation_input_tokens ?? null) ?? 0;
    stats.cacheReadInputTokens += asNumber(usage.cache_read_input_tokens ?? null) ?? 0;
};

const updateStatsFromEntry = (stats: SessionStats, entry: ClaudeCodeTranscriptEntry) => {
    if (entry.type === 'user' || entry.type === 'assistant') {
        stats.messageCount += 1;
    }

    if (entry.role === 'user') {
        stats.userMessageCount += 1;
    }

    if (entry.role === 'assistant') {
        stats.assistantMessageCount += 1;
    }

    if (entry.type === 'attachment') {
        stats.attachmentCount += 1;
    }

    stats.toolCallCount += entry.parts.filter((part) => part.type === 'tool_use').length;
    stats.toolResultCount += entry.parts.filter((part) => part.type === 'tool_result').length;
    addUsageStats(stats, asObject(entry.raw.message ?? null));
};

const updateTimeline = (
    timeline: { firstMs: number | null; lastMs: number | null },
    raw: Record<string, JsonValue>,
) => {
    const timestampMs = parseTimestampMs(raw.timestamp);
    if (timestampMs === null) {
        return;
    }

    timeline.firstMs = timeline.firstMs === null ? timestampMs : Math.min(timeline.firstMs, timestampMs);
    timeline.lastMs = timeline.lastMs === null ? timestampMs : Math.max(timeline.lastMs, timestampMs);
};

const readTitleCandidate = (raw: Record<string, JsonValue>): string | null => {
    const type = asString(raw.type ?? null);
    if (type !== 'ai-title' && type !== 'custom-title') {
        return null;
    }

    return cleanLabel(asString(raw.title ?? null) ?? asString(raw.content ?? null));
};

const updateIdentityFromRaw = (identity: SessionIdentity, raw: Record<string, JsonValue>) => {
    identity.sessionId = asString(raw.sessionId ?? null) ?? identity.sessionId;
    identity.cwd = asString(raw.cwd ?? null) ?? identity.cwd;
    identity.version = asString(raw.version ?? null) ?? identity.version;
    identity.gitBranch = asString(raw.gitBranch ?? null) ?? identity.gitBranch;

    const message = asObject(raw.message ?? null);
    identity.model = asString(message?.model ?? null) ?? identity.model;
    identity.title = readTitleCandidate(raw) ?? identity.title;
};

const updateIdentityFromEntry = (identity: SessionIdentity, entry: ClaudeCodeTranscriptEntry) => {
    if (entry.role === 'user' && !identity.firstUserText) {
        const textPart = entry.parts.find((part) => part.type === 'text' && part.text?.trim());
        identity.firstUserText = cleanExtractedText(textPart?.text ?? '').trim() || null;
    }
};

const toTimeline = (
    timeline: { firstMs: number | null; lastMs: number | null },
    fallbackMs: number | null,
): SessionTimeline => {
    const createdAtMs = timeline.firstMs ?? fallbackMs;
    const lastActiveAtMs = timeline.lastMs ?? fallbackMs;
    return {
        createdAtIso: toIso(createdAtMs),
        createdAtMs,
        lastActiveAtIso: toIso(lastActiveAtMs),
        lastActiveAtMs,
    };
};

const getTitle = (identity: SessionIdentity): string => {
    return cleanInlineTitle(identity.title ?? identity.firstUserText ?? identity.sessionId);
};

const toSessionSummary = (
    file: TranscriptFile,
    identity: SessionIdentity,
    stats: SessionStats,
    timeline: SessionTimeline,
): ClaudeCodeSessionSummary => {
    const worktree = identity.cwd ?? decodeWorktreeFromDirectoryName(file.directoryName);
    const workspaceLabel = getWorkspaceLabel(worktree);
    const totalTokens =
        stats.inputTokens + stats.outputTokens + stats.cacheCreationInputTokens + stats.cacheReadInputTokens;

    return {
        ...stats,
        ...timeline,
        cwd: identity.cwd,
        filePath: file.filePath,
        gitBranch: identity.gitBranch,
        model: identity.model,
        sessionId: identity.sessionId,
        title: getTitle(identity),
        totalTokens,
        version: identity.version,
        workspaceKey: getWorkspaceKey(file.directoryName),
        workspaceLabel,
        worktree,
    };
};

const isRenderablePart = (part: ClaudeCodeTranscriptPart): boolean => {
    if (part.type === 'text' || part.type === 'thinking' || part.type === 'attachment') {
        return Boolean(part.text?.trim());
    }

    if (part.type === 'tool_use') {
        return Boolean(part.toolName || part.argumentsText?.trim());
    }

    if (part.type === 'tool_result') {
        return Boolean(part.outputText?.trim());
    }

    return false;
};

const readTranscriptFile = async (file: TranscriptFile): Promise<ParsedTranscriptFile | null> => {
    const fallbackMtimeMs = await stat(file.filePath)
        .then((stats) => stats.mtimeMs)
        .catch(() => null);
    const identity: SessionIdentity = {
        cwd: null,
        firstUserText: null,
        gitBranch: null,
        model: null,
        sessionId: path.basename(file.filePath, '.jsonl'),
        title: null,
        version: null,
    };
    const stats = createEmptyStats();
    const timeline = { firstMs: null as number | null, lastMs: null as number | null };
    const entries: ClaudeCodeTranscriptEntry[] = [];
    const rawEvents: Record<string, JsonValue>[] = [];

    for await (const raw of readJsonlObjects(file.filePath)) {
        rawEvents.push(raw);
        updateTimeline(timeline, raw);
        updateIdentityFromRaw(identity, raw);

        const entry = parseTranscriptEntry(raw);
        if (!entry) {
            continue;
        }

        entries.push(entry);
        updateStatsFromEntry(stats, entry);
        updateIdentityFromEntry(identity, entry);
    }

    const session = toSessionSummary(file, identity, stats, toTimeline(timeline, fallbackMtimeMs));
    const renderablePartCount = entries.reduce(
        (total, entry) => total + entry.parts.filter(isRenderablePart).length,
        0,
    );

    return {
        transcript: {
            entries,
            rawEvents,
            renderablePartCount,
            session,
        },
    };
};

const listTranscriptFilesForProject = async (projectsDir: string, directoryName: string): Promise<TranscriptFile[]> => {
    const projectDir = path.join(projectsDir, directoryName);
    const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => ({
            directoryName,
            filePath: path.join(projectDir, entry.name),
        }));
};

const listTranscriptFiles = async (projectsDir: string): Promise<TranscriptFile[]> => {
    if (!(await pathExists(projectsDir))) {
        return [];
    }

    const projectDirs = (await readdir(projectsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const groupedFiles = await mapWithConcurrency(projectDirs, READ_CONCURRENCY, (directoryName) =>
        listTranscriptFilesForProject(projectsDir, directoryName),
    );
    return groupedFiles.flat();
};

const readTranscriptFiles = async (files: TranscriptFile[]): Promise<ClaudeCodeSessionTranscript[]> => {
    const parsed = await mapWithConcurrency(files, READ_CONCURRENCY, readTranscriptFile);
    return parsed.flatMap((item) => (item ? [item.transcript] : []));
};

const compareNullableMsDesc = (left: number | null, right: number | null): number => {
    return (right ?? 0) - (left ?? 0);
};

const toWorkspaceGroup = (directoryName: string, sessions: ClaudeCodeSessionSummary[]): ClaudeCodeWorkspaceGroup => {
    const worktree = sessions[0]?.worktree ?? decodeWorktreeFromDirectoryName(directoryName);
    const lastActiveAtMs = sessions.reduce<number | null>((latest, session) => {
        if (session.lastActiveAtMs === null) {
            return latest;
        }

        return latest === null ? session.lastActiveAtMs : Math.max(latest, session.lastActiveAtMs);
    }, null);

    return {
        assistantMessageCount: sessions.reduce((total, session) => total + session.assistantMessageCount, 0),
        directoryName,
        key: getWorkspaceKey(directoryName),
        label: getWorkspaceLabel(worktree),
        lastActiveAtIso: toIso(lastActiveAtMs),
        lastActiveAtMs,
        messageCount: sessions.reduce((total, session) => total + session.messageCount, 0),
        sessionCount: sessions.length,
        toolCallCount: sessions.reduce((total, session) => total + session.toolCallCount, 0),
        toolResultCount: sessions.reduce((total, session) => total + session.toolResultCount, 0),
        uri: getWorkspaceUri(worktree),
        userMessageCount: sessions.reduce((total, session) => total + session.userMessageCount, 0),
        worktree,
    };
};

export const listClaudeCodeWorkspaceGroups = async (
    projectsDir = resolveClaudeCodeProjectsDir(),
): Promise<ClaudeCodeWorkspaceGroup[]> => {
    const files = await listTranscriptFiles(projectsDir);
    const transcripts = await readTranscriptFiles(files);
    const sessionsByDirectory = new Map<string, ClaudeCodeSessionSummary[]>();

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

const normalizePathQuery = (value: string): string => expandHome(value.trim()).replace(/\/+$/u, '');

const claudeCodeWorkspaceMatchesQuery = (workspace: ClaudeCodeWorkspaceGroup, query: string): boolean => {
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

    if (raw.startsWith('/') || raw.startsWith('~') || raw.includes('/')) {
        const normalized = normalizePathQuery(raw);
        const worktree = normalizePathQuery(workspace.worktree);
        return worktree === normalized || worktree.endsWith(normalized);
    }

    return getPortablePathBasename(workspace.worktree).toLowerCase() === lowered;
};

export const findClaudeCodeWorkspaceGroups = (
    groups: ClaudeCodeWorkspaceGroup[],
    query: string,
): ClaudeCodeWorkspaceGroup[] => {
    return groups.filter((group) => claudeCodeWorkspaceMatchesQuery(group, query));
};

const sortSessions = (sessions: ClaudeCodeSessionSummary[]): ClaudeCodeSessionSummary[] => {
    return sessions.sort(
        (left, right) =>
            compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) || left.title.localeCompare(right.title),
    );
};

export const listClaudeCodeSessionsForGroup = async (
    workspaceKey: string,
    projectsDir = resolveClaudeCodeProjectsDir(),
): Promise<ClaudeCodeSessionSummary[]> => {
    const directoryName = getDirectoryNameFromWorkspaceKey(workspaceKey);
    if (!directoryName || !(await pathExists(projectsDir))) {
        return [];
    }

    const files = await listTranscriptFilesForProject(projectsDir, directoryName);
    const transcripts = await readTranscriptFiles(files);
    return sortSessions(transcripts.map((transcript) => transcript.session));
};

const locateSessionFile = async (projectsDir: string, sessionId: string): Promise<TranscriptFile | null> => {
    const files = await listTranscriptFiles(projectsDir);
    return files.find((file) => path.basename(file.filePath, '.jsonl') === sessionId) ?? null;
};

export const readClaudeCodeSessionTranscript = async (
    projectsDir: string,
    sessionId: string,
): Promise<ClaudeCodeSessionTranscript | null> => {
    if (!(await pathExists(projectsDir))) {
        return null;
    }

    const file = await locateSessionFile(projectsDir, sessionId);
    if (!file) {
        return null;
    }

    return (await readTranscriptFile(file))?.transcript ?? null;
};
