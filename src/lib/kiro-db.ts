import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { mapWithConcurrency } from './concurrency';
import {
    getDefaultKiroDataDir,
    type KiroSessionSummary,
    type KiroSessionTranscript,
    type KiroTranscriptEntry,
    type KiroTranscriptPart,
    type KiroWorkspaceGroup,
    resolveKiroWorkspaceSessionsDir,
} from './kiro-exporter-types';
import {
    asObject,
    asString,
    cleanExtractedText,
    cleanInlineTitle,
    getPortablePathBasename,
    isWorkspacePathQuery,
    type JsonValue,
    workspacePathMatchesQuery,
} from './shared';

export { getDefaultKiroDataDir, resolveKiroWorkspaceSessionsDir };

const READ_CONCURRENCY = 8;
const WORKSPACE_KEY_PREFIX = 'workspace:';

type KiroSessionIndexEntry = {
    createdAtMs: number | null;
    sessionId: string;
    title: string | null;
    workspaceDirectory: string | null;
};

type KiroSessionFile = {
    directoryName: string;
    filePath: string;
    indexEntry: KiroSessionIndexEntry | null;
};

type KiroExecutionFile = {
    filePath: string;
    raw: Record<string, JsonValue>;
};

type ReadSessionFileOptions = {
    includeExecutions?: boolean;
    sessionsDir: string;
};

type SessionStats = {
    assistantMessageCount: number;
    imageCount: number;
    messageCount: number;
    promptLogCount: number;
    renderablePartCount: number;
    userMessageCount: number;
};

type SessionIdentity = {
    autonomyMode: string | null;
    defaultModelTitle: string | null;
    firstUserText: string | null;
    selectedModel: string | null;
    selectedProfileId: string | null;
    sessionId: string;
    sessionType: string | null;
    title: string | null;
    workspaceDirectory: string | null;
    workspacePath: string | null;
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

    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
        }

        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

const getWorkspaceKey = (directoryName: string): string => `${WORKSPACE_KEY_PREFIX}${directoryName}`;

const getDirectoryNameFromWorkspaceKey = (workspaceKey: string): string | null => {
    return workspaceKey.startsWith(WORKSPACE_KEY_PREFIX) ? workspaceKey.slice(WORKSPACE_KEY_PREFIX.length) : null;
};

const isPlausibleWorkspacePath = (value: string): boolean => {
    return Boolean(value.trim()) && !value.includes('\uFFFD') && !value.includes('\0');
};

const decodeBase64WorkspacePath = (value: string, encoding: BufferEncoding): string | null => {
    try {
        const decoded = Buffer.from(value, encoding).toString('utf8');
        return isPlausibleWorkspacePath(decoded) ? decoded : null;
    } catch {
        return null;
    }
};

const decodeWorkspaceDirectoryName = (directoryName: string): string => {
    // Kiro currently stores base64 with trailing "_" characters standing in for padding.
    const base64WithPadding = directoryName.replace(/_+$/u, (match) => '='.repeat(match.length));
    const decoded =
        decodeBase64WorkspacePath(base64WithPadding, 'base64') ?? decodeBase64WorkspacePath(directoryName, 'base64url');

    return decoded ?? directoryName;
};

const getWorkspaceLabel = (worktree: string): string => {
    return getPortablePathBasename(worktree) || worktree;
};

const getWorkspaceUri = (worktree: string): string => {
    return worktree.startsWith(path.sep) ? `file://${worktree}` : worktree;
};

const cleanLabel = (value: string | null | undefined): string | null => {
    const cleaned = value?.replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned : null;
};

const readJsonObject = async (filePath: string): Promise<Record<string, JsonValue> | null> => {
    const value = (await Bun.file(filePath)
        .json()
        .catch(() => null)) as JsonValue | null;
    return asObject(value);
};

const readSessionIndex = async (workspaceDir: string): Promise<Map<string, KiroSessionIndexEntry>> => {
    const indexPath = path.join(workspaceDir, 'sessions.json');
    const value = (await Bun.file(indexPath)
        .json()
        .catch(() => null)) as JsonValue | null;
    const items = Array.isArray(value) ? value : [];
    const entries = new Map<string, KiroSessionIndexEntry>();

    for (const item of items) {
        const object = asObject(item);
        const sessionId = asString(object?.sessionId ?? null);
        if (!object || !sessionId) {
            continue;
        }

        entries.set(sessionId, {
            createdAtMs: parseTimestampMs(object.dateCreated),
            sessionId,
            title: cleanLabel(asString(object.title ?? null)),
            workspaceDirectory: asString(object.workspaceDirectory ?? null),
        });
    }

    return entries;
};

const parseTextPart = (raw: Record<string, JsonValue>, text: string): KiroTranscriptPart => ({
    raw,
    text,
    type: 'text',
});

const parseImagePart = (raw: Record<string, JsonValue>): KiroTranscriptPart => {
    const imageUrl = asObject(raw.imageUrl ?? null);
    return {
        imageUrl: asString(imageUrl?.url ?? null) ?? asString(raw.url ?? null),
        raw,
        text: 'Image attachment',
        type: 'image',
    };
};

const parseObjectContentPart = (raw: Record<string, JsonValue>): KiroTranscriptPart => {
    const type = asString(raw.type ?? null);
    if (type === 'imageUrl') {
        return parseImagePart(raw);
    }

    const text = asString(raw.text ?? null);
    if (text !== null) {
        return parseTextPart(raw, text);
    }

    return {
        raw,
        type: 'unknown',
    };
};

const parseMessageContentPart = (item: JsonValue): KiroTranscriptPart | null => {
    if (typeof item === 'string') {
        return parseTextPart({ text: item }, item);
    }

    const object = asObject(item);
    return object ? parseObjectContentPart(object) : null;
};

const getTextJoiner = (left: string, right: string): string => {
    const leftTrimmed = left.trim();
    const rightTrimmed = right.trim();
    return leftTrimmed.startsWith('|') && rightTrimmed.startsWith('|') ? '\n' : '\n\n';
};

const mergeTextParts = (left: KiroTranscriptPart, right: KiroTranscriptPart): KiroTranscriptPart => {
    const text = `${left.text ?? ''}${getTextJoiner(left.text ?? '', right.text ?? '')}${right.text ?? ''}`;
    return {
        raw: {
            sourceParts: [left.raw, right.raw],
            text,
            type: 'text',
        },
        text,
        type: 'text',
    };
};

const mergeAdjacentTextParts = (parts: KiroTranscriptPart[]): KiroTranscriptPart[] => {
    const merged: KiroTranscriptPart[] = [];

    for (const part of parts) {
        const previous = merged.at(-1);
        if (previous?.type === 'text' && part.type === 'text') {
            merged[merged.length - 1] = mergeTextParts(previous, part);
            continue;
        }

        merged.push(part);
    }

    return merged;
};

const parseMessageParts = (message: Record<string, JsonValue>): KiroTranscriptPart[] => {
    const content = message.content;
    const items = Array.isArray(content) ? content : [content];
    const parts = items
        .map(parseMessageContentPart)
        .filter((part): part is KiroTranscriptPart => part !== null && part.type !== 'unknown');
    return mergeAdjacentTextParts(parts);
};

const getPromptLogCount = (raw: Record<string, JsonValue>): number => {
    return Array.isArray(raw.promptLogs) ? raw.promptLogs.length : 0;
};

const parseHistoryEntry = (raw: Record<string, JsonValue>, index: number): KiroTranscriptEntry | null => {
    const message = asObject(raw.message ?? null);
    if (!message) {
        return null;
    }

    const parts = parseMessageParts(message);
    if (parts.length === 0) {
        return null;
    }

    return {
        entryId: asString(message.id ?? null) ?? `entry:${index}`,
        entryType: 'message',
        executionId: asString(raw.executionId ?? null),
        parts,
        promptLogCount: getPromptLogCount(raw),
        raw,
        role: asString(message.role ?? null) ?? 'message',
        timestamp: null,
    };
};

const createEmptyStats = (): SessionStats => ({
    assistantMessageCount: 0,
    imageCount: 0,
    messageCount: 0,
    promptLogCount: 0,
    renderablePartCount: 0,
    userMessageCount: 0,
});

const updateStatsFromEntry = (stats: SessionStats, entry: KiroTranscriptEntry) => {
    if (entry.role === 'assistant' || entry.role === 'user') {
        stats.messageCount += 1;
    }

    if (entry.role === 'assistant') {
        stats.assistantMessageCount += 1;
    }

    if (entry.role === 'user') {
        stats.userMessageCount += 1;
    }

    stats.imageCount += entry.parts.filter((part) => part.type === 'image').length;
    stats.promptLogCount += entry.promptLogCount;
    stats.renderablePartCount += entry.parts.filter(isRenderablePart).length;
};

const updateIdentityFromRaw = (identity: SessionIdentity, raw: Record<string, JsonValue>) => {
    const rawString = (key: string): string | null => asString(raw[key] ?? null);
    const rawValues = {
        autonomyMode: rawString('autonomyMode'),
        defaultModelTitle: rawString('defaultModelTitle'),
        selectedModel: rawString('selectedModel'),
        selectedProfileId: rawString('selectedProfileId'),
        sessionId: rawString('sessionId'),
        sessionType: rawString('sessionType'),
        title: cleanLabel(rawString('title')),
        workspaceDirectory: rawString('workspaceDirectory'),
        workspacePath: rawString('workspacePath'),
    };

    identity.autonomyMode = rawValues.autonomyMode ?? identity.autonomyMode;
    identity.defaultModelTitle = rawValues.defaultModelTitle ?? identity.defaultModelTitle;
    identity.selectedModel = rawValues.selectedModel ?? identity.selectedModel;
    identity.selectedProfileId = rawValues.selectedProfileId ?? identity.selectedProfileId;
    identity.sessionId = rawValues.sessionId ?? identity.sessionId;
    identity.sessionType = rawValues.sessionType ?? identity.sessionType;
    identity.title = rawValues.title ?? identity.title;
    identity.workspaceDirectory = rawValues.workspaceDirectory ?? identity.workspaceDirectory;
    identity.workspacePath = rawValues.workspacePath ?? identity.workspacePath;
};

const updateIdentityFromEntry = (identity: SessionIdentity, entry: KiroTranscriptEntry) => {
    if (entry.role !== 'user' || identity.firstUserText) {
        return;
    }

    const textPart = entry.parts.find((part) => part.type === 'text' && part.text?.trim());
    identity.firstUserText = cleanExtractedText(textPart?.text ?? '').trim() || null;
};

const getEntryText = (entry: KiroTranscriptEntry): string => {
    return entry.parts
        .filter((part) => part.type === 'text')
        .map((part) => cleanExtractedText(part.text ?? '').trim())
        .filter(Boolean)
        .join('\n\n')
        .trim();
};

const KIRO_ASSISTANT_PLACEHOLDER_PATTERN = /^on it[.!]?$/iu;

const isAssistantPlaceholderEntry = (entry: KiroTranscriptEntry): boolean => {
    return entry.role === 'assistant' && KIRO_ASSISTANT_PLACEHOLDER_PATTERN.test(getEntryText(entry));
};

const isRenderablePart = (part: KiroTranscriptPart): boolean => {
    if (part.type === 'image') {
        return true;
    }

    if (part.type === 'text') {
        return Boolean(part.text?.trim());
    }

    return false;
};

const getTitle = (identity: SessionIdentity, indexEntry: KiroSessionIndexEntry | null): string => {
    return cleanInlineTitle(identity.title ?? indexEntry?.title ?? identity.firstUserText ?? identity.sessionId);
};

const getCreatedAtMs = (
    indexEntry: KiroSessionIndexEntry | null,
    fileStats: { birthtimeMs: number; mtimeMs: number } | null,
): number | null => {
    return indexEntry?.createdAtMs ?? fileStats?.birthtimeMs ?? fileStats?.mtimeMs ?? null;
};

const getLastActiveAtMs = (
    indexEntry: KiroSessionIndexEntry | null,
    fileStats: { birthtimeMs: number; mtimeMs: number } | null,
): number | null => {
    return fileStats?.mtimeMs ?? indexEntry?.createdAtMs ?? null;
};

const toSessionSummary = (
    file: KiroSessionFile,
    identity: SessionIdentity,
    stats: SessionStats,
    fileStats: { birthtimeMs: number; mtimeMs: number } | null,
): KiroSessionSummary => {
    const worktree =
        identity.workspaceDirectory ??
        identity.workspacePath ??
        file.indexEntry?.workspaceDirectory ??
        decodeWorkspaceDirectoryName(file.directoryName);
    const workspaceLabel = getWorkspaceLabel(worktree);
    const createdAtMs = getCreatedAtMs(file.indexEntry, fileStats);
    const lastActiveAtMs = getLastActiveAtMs(file.indexEntry, fileStats);

    return {
        ...stats,
        autonomyMode: identity.autonomyMode,
        createdAtIso: toIso(createdAtMs),
        createdAtMs,
        defaultModelTitle: identity.defaultModelTitle,
        filePath: file.filePath,
        lastActiveAtIso: toIso(lastActiveAtMs),
        lastActiveAtMs,
        selectedModel: identity.selectedModel,
        selectedProfileId: identity.selectedProfileId,
        sessionId: identity.sessionId,
        sessionType: identity.sessionType,
        title: getTitle(identity, file.indexEntry),
        workspaceDirectory: identity.workspaceDirectory ?? file.indexEntry?.workspaceDirectory ?? null,
        workspaceKey: getWorkspaceKey(file.directoryName),
        workspaceLabel,
        workspacePath: identity.workspacePath,
        worktree,
    };
};

const getKiroDataDirFromSessionsDir = (sessionsDir: string): string => {
    return path.basename(sessionsDir) === 'workspace-sessions' ? path.dirname(sessionsDir) : sessionsDir;
};

const getKiroWorkspaceHash = (workspacePath: string): string => {
    return createHash('sha256').update(workspacePath).digest('hex').slice(0, 32);
};

const listFilesRecursively = async (root: string, maxDepth = 3): Promise<string[]> => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];

    for (const entry of entries) {
        const entryPath = path.join(root, entry.name);
        if (entry.isFile()) {
            files.push(entryPath);
            continue;
        }

        if (entry.isDirectory() && maxDepth > 0) {
            files.push(...(await listFilesRecursively(entryPath, maxDepth - 1)));
        }
    }

    return files;
};

const listExecutionFilesForSession = async (
    dataDir: string,
    sessionId: string,
    worktree: string,
): Promise<KiroExecutionFile[]> => {
    const workspaceExecutionRoot = path.join(dataDir, getKiroWorkspaceHash(worktree));
    if (!(await pathExists(workspaceExecutionRoot))) {
        return [];
    }

    const files = await listFilesRecursively(workspaceExecutionRoot);
    const executions = await mapWithConcurrency(files, READ_CONCURRENCY, async (filePath) => {
        const raw = await readJsonObject(filePath);
        return asString(raw?.chatSessionId ?? null) === sessionId && raw ? { filePath, raw } : null;
    });

    return executions.flatMap((execution) => (execution ? [execution] : []));
};

const getActionTimestamp = (action: Record<string, JsonValue>, execution: Record<string, JsonValue>): string | null => {
    return toIso(
        parseTimestampMs(action.emittedAt) ?? parseTimestampMs(action.endTime) ?? parseTimestampMs(execution.endTime),
    );
};

const formatHumanLine = (value: JsonValue | undefined): number | null => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
        return null;
    }

    return value + 1;
};

const formatFileRange = (file: Record<string, JsonValue>): string => {
    const range = asObject(file.range ?? null);
    const startLine = formatHumanLine(range?.startLine);
    const endLine = formatHumanLine(range?.endLine);
    if (startLine !== null && endLine !== null) {
        return `:${startLine}-${endLine}`;
    }
    if (startLine !== null) {
        return `:${startLine}`;
    }
    return '';
};

const formatToolItems = (singularPrefix: string, pluralPrefix: string, items: string[]): string => {
    if (items.length === 1) {
        return `${singularPrefix}: ${items[0]}`;
    }

    return `${pluralPrefix}:\n${items.map((item) => `- ${item}`).join('\n')}`;
};

const getToolCallSummary = (action: Record<string, JsonValue>): { command: string; toolName: string } | null => {
    const input = asObject(action.input ?? null);
    if (!input) {
        return null;
    }

    const files = Array.isArray(input.files)
        ? input.files.flatMap((item) => {
              const file = asObject(item);
              const filePath = asString(file?.path ?? null);
              return file && filePath ? [`${filePath}${formatFileRange(file)}`] : [];
          })
        : [];
    if (files.length > 0) {
        return {
            command: formatToolItems('Read file', 'Read files', files),
            toolName: 'read_file',
        };
    }

    const documents = Array.isArray(input.documents)
        ? input.documents.flatMap((item) => {
              const document = typeof item === 'string' ? item : asString(asObject(item)?.uri ?? null);
              return document ? [document] : [];
          })
        : [];
    if (documents.length > 0) {
        return {
            command: formatToolItems('Read document', 'Read documents', documents),
            toolName: 'read_file',
        };
    }

    const query = asString(input.query ?? null);
    const why = asString(input.why ?? null);
    if (query || why) {
        return {
            command: `Search: ${why ?? query}${why && query ? `\nQuery: ${query}` : ''}`,
            toolName: 'search',
        };
    }

    return null;
};

const parseExecutionActionMessageEntry = (
    execution: KiroExecutionFile,
    action: Record<string, JsonValue>,
    index: number,
): KiroTranscriptEntry | null => {
    const output = asObject(action.output ?? null);
    const text = cleanExtractedText(asString(output?.message ?? null) ?? '').trim();
    if (!text) {
        return null;
    }

    const executionId = asString(execution.raw.executionId ?? null);
    const actionId = asString(action.actionId ?? null) ?? `action:${index}`;

    return {
        entryId: `${executionId ?? path.basename(execution.filePath)}:${actionId}`,
        entryType: 'message',
        executionId,
        parts: [
            parseTextPart(
                {
                    actionId,
                    executionFilePath: execution.filePath,
                    message: text,
                    type: 'assistantMessage',
                },
                text,
            ),
        ],
        promptLogCount: 0,
        raw: {
            ...action,
            executionFilePath: execution.filePath,
        },
        role: 'assistant',
        timestamp: getActionTimestamp(action, execution.raw),
    };
};

const parseExecutionActionToolEntry = (
    execution: KiroExecutionFile,
    action: Record<string, JsonValue>,
    index: number,
): KiroTranscriptEntry | null => {
    const summary = getToolCallSummary(action);
    if (!summary) {
        return null;
    }

    const executionId = asString(execution.raw.executionId ?? null);
    const actionId = asString(action.actionId ?? null) ?? `action:${index}`;

    return {
        entryId: `${executionId ?? path.basename(execution.filePath)}:${actionId}`,
        entryType: 'tool_call',
        executionId,
        parts: [
            parseTextPart(
                {
                    actionId,
                    command: summary.command,
                    executionFilePath: execution.filePath,
                    toolName: summary.toolName,
                    type: 'toolCall',
                },
                summary.command,
            ),
        ],
        promptLogCount: 0,
        raw: {
            ...action,
            executionFilePath: execution.filePath,
        },
        role: 'tool',
        timestamp: getActionTimestamp(action, execution.raw),
    };
};

const parseExecutionActionEntries = (
    execution: KiroExecutionFile,
    action: Record<string, JsonValue>,
    index: number,
): KiroTranscriptEntry[] => {
    const entries = [
        parseExecutionActionToolEntry(execution, action, index),
        parseExecutionActionMessageEntry(execution, action, index),
    ];
    return entries.filter((entry): entry is KiroTranscriptEntry => entry !== null);
};

const parseExecutionEntries = (execution: KiroExecutionFile): KiroTranscriptEntry[] => {
    const actions = Array.isArray(execution.raw.actions) ? execution.raw.actions : [];
    return actions.flatMap((item, index) => {
        const action = asObject(item);
        return action ? parseExecutionActionEntries(execution, action, index) : [];
    });
};

const compareExecutionFiles = (left: KiroExecutionFile, right: KiroExecutionFile): number => {
    return (
        (parseTimestampMs(left.raw.startTime) ?? 0) - (parseTimestampMs(right.raw.startTime) ?? 0) ||
        left.filePath.localeCompare(right.filePath)
    );
};

const readExecutionEntries = async (
    sessionsDir: string,
    session: KiroSessionSummary,
): Promise<KiroTranscriptEntry[]> => {
    const executions = await listExecutionFilesForSession(
        getKiroDataDirFromSessionsDir(sessionsDir),
        session.sessionId,
        session.worktree,
    );
    return executions.sort(compareExecutionFiles).flatMap(parseExecutionEntries);
};

const getVisibleEntries = (
    historyEntries: KiroTranscriptEntry[],
    executionEntries: KiroTranscriptEntry[],
): KiroTranscriptEntry[] => {
    if (executionEntries.length === 0) {
        return historyEntries;
    }

    const executionEntriesById = new Map<string, KiroTranscriptEntry[]>();
    for (const entry of executionEntries) {
        if (!entry.executionId) {
            continue;
        }

        const entries = executionEntriesById.get(entry.executionId) ?? [];
        entries.push(entry);
        executionEntriesById.set(entry.executionId, entries);
    }

    const usedExecutionIds = new Set<string>();
    const visibleEntries: KiroTranscriptEntry[] = [];
    for (const entry of historyEntries) {
        const matchingExecutionEntries = entry.executionId ? executionEntriesById.get(entry.executionId) : undefined;
        if (isAssistantPlaceholderEntry(entry)) {
            if (matchingExecutionEntries) {
                visibleEntries.push(...matchingExecutionEntries);
                usedExecutionIds.add(entry.executionId!);
            }
            continue;
        }

        visibleEntries.push(entry);
    }

    visibleEntries.push(
        ...executionEntries.filter((entry) => !entry.executionId || !usedExecutionIds.has(entry.executionId)),
    );
    return visibleEntries;
};

const createStatsFromEntries = (entries: KiroTranscriptEntry[]): SessionStats => {
    const stats = createEmptyStats();
    for (const entry of entries) {
        updateStatsFromEntry(stats, entry);
    }
    return stats;
};

const readSessionFile = async (
    file: KiroSessionFile,
    options: ReadSessionFileOptions,
): Promise<KiroSessionTranscript | null> => {
    const rawSession = await readJsonObject(file.filePath);
    if (!rawSession) {
        return null;
    }

    const fileStats = await stat(file.filePath)
        .then((stats) => ({ birthtimeMs: stats.birthtimeMs, mtimeMs: stats.mtimeMs }))
        .catch(() => null);
    const identity: SessionIdentity = {
        autonomyMode: null,
        defaultModelTitle: null,
        firstUserText: null,
        selectedModel: null,
        selectedProfileId: null,
        sessionId: path.basename(file.filePath, '.json'),
        sessionType: null,
        title: null,
        workspaceDirectory: file.indexEntry?.workspaceDirectory ?? null,
        workspacePath: null,
    };
    const historyEntries: KiroTranscriptEntry[] = [];
    const history = Array.isArray(rawSession.history) ? rawSession.history : [];

    updateIdentityFromRaw(identity, rawSession);

    history.forEach((item, index) => {
        const raw = asObject(item);
        if (!raw) {
            return;
        }

        const entry = parseHistoryEntry(raw, index);
        if (!entry) {
            return;
        }

        historyEntries.push(entry);
        updateIdentityFromEntry(identity, entry);
    });

    const baseSummary = toSessionSummary(file, identity, createEmptyStats(), fileStats);
    const executionEntries = options.includeExecutions
        ? await readExecutionEntries(options.sessionsDir, baseSummary)
        : [];
    const entries = getVisibleEntries(historyEntries, executionEntries);
    const stats = createStatsFromEntries(entries);
    return {
        entries,
        rawSession,
        renderablePartCount: stats.renderablePartCount,
        session: toSessionSummary(file, identity, stats, fileStats),
    };
};

const listSessionFilesForWorkspace = async (sessionsDir: string, directoryName: string): Promise<KiroSessionFile[]> => {
    const workspaceDir = path.join(sessionsDir, directoryName);
    const index = await readSessionIndex(workspaceDir);
    const entries = await readdir(workspaceDir, { withFileTypes: true }).catch(() => []);

    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'sessions.json')
        .map((entry) => {
            const sessionId = path.basename(entry.name, '.json');
            return {
                directoryName,
                filePath: path.join(workspaceDir, entry.name),
                indexEntry: index.get(sessionId) ?? null,
            };
        });
};

const listSessionFiles = async (sessionsDir: string): Promise<KiroSessionFile[]> => {
    if (!(await pathExists(sessionsDir))) {
        return [];
    }

    const workspaceDirs = (await readdir(sessionsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const groupedFiles = await mapWithConcurrency(workspaceDirs, READ_CONCURRENCY, (directoryName) =>
        listSessionFilesForWorkspace(sessionsDir, directoryName),
    );
    return groupedFiles.flat();
};

const readSessionFiles = async (files: KiroSessionFile[]): Promise<KiroSessionTranscript[]> => {
    const transcripts = await mapWithConcurrency(files, READ_CONCURRENCY, (file) =>
        readSessionFile(file, { includeExecutions: false, sessionsDir: path.dirname(path.dirname(file.filePath)) }),
    );
    return transcripts.flatMap((transcript) => (transcript ? [transcript] : []));
};

const compareNullableMsDesc = (left: number | null, right: number | null): number => {
    return (right ?? 0) - (left ?? 0);
};

const sumSessions = (sessions: KiroSessionSummary[], key: keyof SessionStats): number => {
    return sessions.reduce((total, session) => total + session[key], 0);
};

const toWorkspaceGroup = (directoryName: string, sessions: KiroSessionSummary[]): KiroWorkspaceGroup => {
    const worktree = sessions[0]?.worktree ?? decodeWorkspaceDirectoryName(directoryName);
    const lastActiveAtMs = sessions.reduce<number | null>((latest, session) => {
        if (session.lastActiveAtMs === null) {
            return latest;
        }

        return latest === null ? session.lastActiveAtMs : Math.max(latest, session.lastActiveAtMs);
    }, null);

    return {
        assistantMessageCount: sumSessions(sessions, 'assistantMessageCount'),
        directoryName,
        imageCount: sumSessions(sessions, 'imageCount'),
        key: getWorkspaceKey(directoryName),
        label: getWorkspaceLabel(worktree),
        lastActiveAtIso: toIso(lastActiveAtMs),
        lastActiveAtMs,
        messageCount: sumSessions(sessions, 'messageCount'),
        promptLogCount: sumSessions(sessions, 'promptLogCount'),
        sessionCount: sessions.length,
        uri: getWorkspaceUri(worktree),
        userMessageCount: sumSessions(sessions, 'userMessageCount'),
        worktree,
    };
};

export const listKiroWorkspaceGroups = async (
    sessionsDir = resolveKiroWorkspaceSessionsDir(),
): Promise<KiroWorkspaceGroup[]> => {
    const files = await listSessionFiles(sessionsDir);
    const transcripts = await readSessionFiles(files);
    const sessionsByDirectory = new Map<string, KiroSessionSummary[]>();

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

const kiroWorkspaceMatchesQuery = (workspace: KiroWorkspaceGroup, query: string): boolean => {
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

export const findKiroWorkspaceGroups = (groups: KiroWorkspaceGroup[], query: string): KiroWorkspaceGroup[] => {
    return groups.filter((group) => kiroWorkspaceMatchesQuery(group, query));
};

const sortSessions = (sessions: KiroSessionSummary[]): KiroSessionSummary[] => {
    return [...sessions].sort(
        (left, right) =>
            compareNullableMsDesc(left.lastActiveAtMs, right.lastActiveAtMs) || left.title.localeCompare(right.title),
    );
};

export const listKiroSessionsForGroup = async (
    workspaceKey: string,
    sessionsDir = resolveKiroWorkspaceSessionsDir(),
): Promise<KiroSessionSummary[]> => {
    const directoryName = getDirectoryNameFromWorkspaceKey(workspaceKey);
    if (!directoryName || !(await pathExists(sessionsDir))) {
        return [];
    }

    const files = await listSessionFilesForWorkspace(sessionsDir, directoryName);
    const transcripts = await readSessionFiles(files);
    return sortSessions(transcripts.map((transcript) => transcript.session));
};

const locateSessionFile = async (sessionsDir: string, sessionId: string): Promise<KiroSessionFile | null> => {
    const files = await listSessionFiles(sessionsDir);
    return files.find((file) => path.basename(file.filePath, '.json') === sessionId) ?? null;
};

export const readKiroSessionTranscript = async (
    sessionsDir: string,
    sessionId: string,
): Promise<KiroSessionTranscript | null> => {
    if (!(await pathExists(sessionsDir))) {
        return null;
    }

    const file = await locateSessionFile(sessionsDir, sessionId);
    if (!file) {
        return null;
    }

    return readSessionFile(file, { includeExecutions: true, sessionsDir });
};
