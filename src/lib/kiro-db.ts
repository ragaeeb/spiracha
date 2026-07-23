import { createHash, randomUUID } from 'node:crypto';
import { readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createConcurrencyLimiter, mapWithConcurrency } from './concurrency';
import {
    getDefaultKiroDataDir,
    type KiroSessionSummary,
    type KiroSessionTranscript,
    type KiroTranscriptEntry,
    type KiroTranscriptPart,
    type KiroWorkspaceGroup,
    resolveKiroWorkspaceSessionsDir,
} from './kiro-exporter-types';
import { isKiroAssistantPlaceholderEntry } from './kiro-transcript-phase';
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
    workspacePathMatchesQuery,
} from './shared';

export { getDefaultKiroDataDir, resolveKiroWorkspaceSessionsDir };

const READ_CONCURRENCY = 8;
const DELETE_CONCURRENCY = 1;
const EXECUTION_CACHE_TTL_MS = 1_000;
const WORKSPACE_KEY_PREFIX = 'workspace:';
const kiroDeleteLimiter = createConcurrencyLimiter(DELETE_CONCURRENCY);
const executionFilesCache = new Map<string, { expiresAtMs: number; files: KiroExecutionFile[] }>();

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

export type DeleteKiroSessionResult = {
    deletedFiles: string[];
    deletedSessionIds: string[];
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

const parseTimestampStringMs = (value: string): number | null => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseTimestampMs = (value: JsonValue | undefined): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    }

    if (typeof value === 'string') {
        return value.trim() ? parseTimestampStringMs(value) : null;
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
        timestamp: toIso(
            parseTimestampMs(raw.timestamp ?? raw.createdAt ?? raw.created_at ?? message.timestamp ?? null),
        ),
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
        continuationSessionIds: [identity.sessionId],
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
    const entries = await readDirectoryEntriesIfExists(root);
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

    const cached = executionFilesCache.get(workspaceExecutionRoot);
    let executions = cached && cached.expiresAtMs > Date.now() ? cached.files : null;
    if (!executions) {
        const files = await listFilesRecursively(workspaceExecutionRoot);
        executions = (
            await mapWithConcurrency(files, READ_CONCURRENCY, async (filePath) => {
                const raw = await readJsonObject(filePath);
                return raw ? { filePath, raw } : null;
            })
        ).flatMap((execution) => (execution ? [execution] : []));
        executionFilesCache.set(workspaceExecutionRoot, {
            expiresAtMs: Date.now() + EXECUTION_CACHE_TTL_MS,
            files: executions,
        });
    }

    return executions.filter((execution) => asString(execution.raw.chatSessionId ?? null) === sessionId);
};

const getActionTimestamp = (action: Record<string, JsonValue>, execution: Record<string, JsonValue>): string | null => {
    return toIso(
        parseTimestampMs(action.emittedAt) ??
            parseTimestampMs(action.endTime) ??
            parseTimestampMs(execution.endTime) ??
            parseTimestampMs(execution.startTime),
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

type KiroToolCallSummary = {
    command: string;
    toolName: string;
    workdir: string | null;
};

const getCommandToolCallSummary = (input: Record<string, JsonValue>): KiroToolCallSummary | null => {
    const command = asString(input.command ?? null);
    return command
        ? {
              command,
              toolName: 'run_command',
              workdir: asString(input.cwd ?? null),
          }
        : null;
};

const getFileToolCallSummary = (input: Record<string, JsonValue>): KiroToolCallSummary | null => {
    const files = Array.isArray(input.files)
        ? input.files.flatMap((item) => {
              const file = asObject(item);
              const filePath = asString(file?.path ?? null);
              return file && filePath ? [`${filePath}${formatFileRange(file)}`] : [];
          })
        : [];
    return files.length > 0
        ? {
              command: formatToolItems('Read file', 'Read files', files),
              toolName: 'read_file',
              workdir: null,
          }
        : null;
};

const getDocumentToolCallSummary = (input: Record<string, JsonValue>): KiroToolCallSummary | null => {
    const documents = Array.isArray(input.documents)
        ? input.documents.flatMap((item) => {
              const document = typeof item === 'string' ? item : asString(asObject(item)?.uri ?? null);
              return document ? [document] : [];
          })
        : [];
    return documents.length > 0
        ? {
              command: formatToolItems('Read document', 'Read documents', documents),
              toolName: 'read_file',
              workdir: null,
          }
        : null;
};

const getSearchToolCallSummary = (input: Record<string, JsonValue>): KiroToolCallSummary | null => {
    const query = asString(input.query ?? null);
    const why = asString(input.why ?? null);
    return query || why
        ? {
              command: `Search: ${why ?? query}${why && query ? `\nQuery: ${query}` : ''}`,
              toolName: 'search',
              workdir: null,
          }
        : null;
};

const getReplaceToolCallSummary = (
    action: Record<string, JsonValue>,
    input: Record<string, JsonValue>,
): KiroToolCallSummary | null => {
    const file = asString(input.file ?? null);
    return action.actionType === 'replace' && file
        ? {
              command: `Replace file: ${file}`,
              toolName: 'replace',
              workdir: null,
          }
        : null;
};

const getToolCallSummary = (action: Record<string, JsonValue>): KiroToolCallSummary | null => {
    const input = asObject(action.input ?? null);
    return input
        ? (getCommandToolCallSummary(input) ??
              getFileToolCallSummary(input) ??
              getDocumentToolCallSummary(input) ??
              getSearchToolCallSummary(input) ??
              getReplaceToolCallSummary(action, input))
        : null;
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
            executionStartTime: execution.raw.startTime ?? null,
        },
        role: 'assistant',
        timestamp: getActionTimestamp(action, execution.raw),
    };
};

const parseExecutionActionToolEntry = (
    execution: KiroExecutionFile,
    action: Record<string, JsonValue>,
    index: number,
    summary: KiroToolCallSummary | null,
): KiroTranscriptEntry | null => {
    if (!summary) {
        return null;
    }

    const executionId = asString(execution.raw.executionId ?? null);
    const actionId = asString(action.actionId ?? null) ?? `action:${index}`;
    const toolCallId = `${executionId ?? path.basename(execution.filePath)}:${actionId}`;

    return {
        entryId: toolCallId,
        entryType: 'tool_call',
        executionId,
        parts: [
            parseTextPart(
                {
                    actionId,
                    command: summary.command,
                    executionFilePath: execution.filePath,
                    toolCallId,
                    toolName: summary.toolName,
                    type: 'toolCall',
                    workdir: summary.workdir,
                },
                summary.command,
            ),
        ],
        promptLogCount: 0,
        raw: {
            ...action,
            executionFilePath: execution.filePath,
            executionStartTime: execution.raw.startTime ?? null,
        },
        role: 'tool',
        timestamp: getActionTimestamp(action, execution.raw),
    };
};

const parseExecutionActionToolOutputEntry = (
    execution: KiroExecutionFile,
    action: Record<string, JsonValue>,
    index: number,
    summary: KiroToolCallSummary | null,
): KiroTranscriptEntry | null => {
    const output = asObject(action.output ?? null);
    const text = cleanExtractedText(asString(output?.output ?? null) ?? '').trim();
    if (!summary || !text) {
        return null;
    }

    const executionId = asString(execution.raw.executionId ?? null);
    const actionId = asString(action.actionId ?? null) ?? `action:${index}`;
    const toolCallId = `${executionId ?? path.basename(execution.filePath)}:${actionId}`;

    return {
        entryId: `${toolCallId}:output`,
        entryType: 'tool_output',
        executionId,
        parts: [
            parseTextPart(
                {
                    actionId,
                    executionFilePath: execution.filePath,
                    exitCode: asNumber(output?.exitCode ?? null),
                    toolCallId,
                    toolName: summary.toolName,
                    type: 'toolOutput',
                },
                text,
            ),
        ],
        promptLogCount: 0,
        raw: {
            ...action,
            executionFilePath: execution.filePath,
            executionStartTime: execution.raw.startTime ?? null,
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
    const toolCallSummary = getToolCallSummary(action);
    const entries = [
        parseExecutionActionToolEntry(execution, action, index, toolCallSummary),
        parseExecutionActionToolOutputEntry(execution, action, index, toolCallSummary),
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

const readExecutionFiles = async (sessionsDir: string, session: KiroSessionSummary): Promise<KiroExecutionFile[]> => {
    const executions = await listExecutionFilesForSession(
        getKiroDataDirFromSessionsDir(sessionsDir),
        session.sessionId,
        session.worktree,
    );
    return executions.sort(compareExecutionFiles);
};

const groupExecutionEntriesById = (executionEntries: KiroTranscriptEntry[]) => {
    const entriesById = new Map<string, KiroTranscriptEntry[]>();
    for (const entry of executionEntries) {
        if (!entry.executionId) {
            continue;
        }

        const entries = entriesById.get(entry.executionId) ?? [];
        entries.push(entry);
        entriesById.set(entry.executionId, entries);
    }
    return entriesById;
};

const replaceExecutionPlaceholders = (
    historyEntries: KiroTranscriptEntry[],
    executionEntriesById: Map<string, KiroTranscriptEntry[]>,
) => {
    const usedExecutionIds = new Set<string>();
    const visibleEntries: KiroTranscriptEntry[] = [];
    for (const entry of historyEntries) {
        const matchingExecutionEntries = entry.executionId ? executionEntriesById.get(entry.executionId) : undefined;
        if (!isKiroAssistantPlaceholderEntry(entry) || !matchingExecutionEntries) {
            visibleEntries.push(entry);
            continue;
        }

        visibleEntries.push(...matchingExecutionEntries);
        usedExecutionIds.add(entry.executionId!);
    }
    return { usedExecutionIds, visibleEntries };
};

const groupUnmatchedExecutionEntries = (executionEntries: KiroTranscriptEntry[], usedExecutionIds: Set<string>) => {
    const groups = new Map<string, KiroTranscriptEntry[]>();
    for (const entry of executionEntries) {
        if (entry.executionId && usedExecutionIds.has(entry.executionId)) {
            continue;
        }

        const groupKey = entry.executionId ?? asString(entry.raw.executionFilePath ?? null) ?? entry.entryId;
        const group = groups.get(groupKey) ?? [];
        group.push(entry);
        groups.set(groupKey, group);
    }
    return groups.values();
};

const replaceUnmatchedPlaceholdersInOrder = (
    visibleEntries: KiroTranscriptEntry[],
    executionGroups: KiroTranscriptEntry[][],
): boolean => {
    const placeholderIndexes = visibleEntries.flatMap((entry, index) =>
        entry.executionId && isKiroAssistantPlaceholderEntry(entry) ? [index] : [],
    );
    if (
        placeholderIndexes.length === 0 ||
        placeholderIndexes.length !== executionGroups.length ||
        executionGroups.some((group) => !group[0]?.executionId)
    ) {
        return false;
    }

    for (let index = placeholderIndexes.length - 1; index >= 0; index -= 1) {
        visibleEntries.splice(placeholderIndexes[index]!, 1, ...executionGroups[index]!);
    }
    return true;
};

const insertExecutionGroupByStartTime = (
    visibleEntries: KiroTranscriptEntry[],
    executionGroup: KiroTranscriptEntry[],
) => {
    const firstEntry = executionGroup[0]!;
    const executionTime = parseTimestampMs(firstEntry.raw.executionStartTime) ?? parseTimestampMs(firstEntry.timestamp);
    const insertionIndex =
        executionTime === null
            ? -1
            : visibleEntries.findIndex((entry) => {
                  const entryTime = parseTimestampMs(entry.timestamp);
                  return entryTime !== null && entryTime > executionTime;
              });
    if (insertionIndex < 0) {
        visibleEntries.push(...executionGroup);
    } else {
        visibleEntries.splice(insertionIndex, 0, ...executionGroup);
    }
};

const getVisibleEntries = (
    historyEntries: KiroTranscriptEntry[],
    executionEntries: KiroTranscriptEntry[],
): KiroTranscriptEntry[] => {
    if (executionEntries.length === 0) {
        return historyEntries;
    }

    const executionEntriesById = groupExecutionEntriesById(executionEntries);
    const { usedExecutionIds, visibleEntries } = replaceExecutionPlaceholders(historyEntries, executionEntriesById);
    const unmatchedExecutionGroups = [...groupUnmatchedExecutionEntries(executionEntries, usedExecutionIds)];
    if (replaceUnmatchedPlaceholdersInOrder(visibleEntries, unmatchedExecutionGroups)) {
        return visibleEntries;
    }

    for (const executionGroup of unmatchedExecutionGroups) {
        insertExecutionGroupByStartTime(visibleEntries, executionGroup);
    }
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
    const rawHistory = Array.isArray(rawSession.history) ? rawSession.history : [];

    updateIdentityFromRaw(identity, rawSession);

    rawHistory.forEach((item, index) => {
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
    const executionFiles = options.includeExecutions ? await readExecutionFiles(options.sessionsDir, baseSummary) : [];
    const executionEntries = executionFiles.flatMap(parseExecutionEntries);
    const entries = getVisibleEntries(historyEntries, executionEntries);
    const stats = createStatsFromEntries(entries);
    return {
        entries,
        executionEntries,
        historyEntries,
        rawHistory,
        rawSession,
        renderablePartCount: stats.renderablePartCount,
        session: toSessionSummary(file, identity, stats, fileStats),
    };
};

const listSessionFilesForWorkspace = async (sessionsDir: string, directoryName: string): Promise<KiroSessionFile[]> => {
    const workspaceDir = path.join(sessionsDir, directoryName);
    const index = await readSessionIndex(workspaceDir);
    const entries = await readDirectoryEntriesIfExists(workspaceDir);

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
    return transcripts.flatMap((transcript) => (transcript && transcript.renderablePartCount > 0 ? [transcript] : []));
};

const KIRO_CONTINUATION_SUMMARY_PATTERN = /^(?:# Conversation Summary|## Summary of Conversation)\b/u;

const getActiveTabIds = (transcript: KiroSessionTranscript): string[] => {
    const activeTabs = transcript.rawSession.activeTabs;
    if (!Array.isArray(activeTabs)) {
        return [];
    }
    const tabIds = activeTabs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return tabIds.length === activeTabs.length ? tabIds : [];
};

const isContinuationSummaryEntry = (entry: KiroTranscriptEntry | undefined): boolean => {
    return entry?.role === 'user' && KIRO_CONTINUATION_SUMMARY_PATTERN.test(getEntryText(entry));
};

const arraysEqual = (left: string[], right: string[]): boolean => {
    return left.length === right.length && left.every((value, index) => value === right[index]);
};

const isStrictPrefix = (prefix: string[], value: string[]): boolean => {
    return prefix.length < value.length && prefix.every((item, index) => item === value[index]);
};

const getValidContinuationChain = (
    transcript: KiroSessionTranscript,
    transcriptsById: Map<string, KiroSessionTranscript>,
): string[] | null => {
    const activeTabIds = getActiveTabIds(transcript);
    if (
        activeTabIds.length < 2 ||
        activeTabIds.at(-1) !== transcript.session.sessionId ||
        new Set(activeTabIds).size !== activeTabIds.length
    ) {
        return null;
    }

    for (const [index, sessionId] of activeTabIds.entries()) {
        const candidate = transcriptsById.get(sessionId);
        if (!candidate || !arraysEqual(getActiveTabIds(candidate), activeTabIds.slice(0, index + 1))) {
            return null;
        }
        if (index > 0 && !isContinuationSummaryEntry(candidate.historyEntries[0])) {
            return null;
        }
    }

    return activeTabIds;
};

const getUnambiguousContinuationChains = (transcripts: KiroSessionTranscript[]): string[][] => {
    const transcriptsById = new Map(transcripts.map((transcript) => [transcript.session.sessionId, transcript]));
    const maximalChains = transcripts
        .flatMap((transcript) => {
            const chain = getValidContinuationChain(transcript, transcriptsById);
            return chain ? [chain] : [];
        })
        .filter(
            (chain, index, chains) =>
                !chains.some((candidate, otherIndex) => otherIndex !== index && isStrictPrefix(chain, candidate)),
        );
    const occurrenceCounts = new Map<string, number>();
    for (const chain of maximalChains) {
        for (const sessionId of chain) {
            occurrenceCounts.set(sessionId, (occurrenceCounts.get(sessionId) ?? 0) + 1);
        }
    }
    return maximalChains.filter((chain) => chain.every((sessionId) => occurrenceCounts.get(sessionId) === 1));
};

const namespaceMergedEntry = (entry: KiroTranscriptEntry, sessionId: string): KiroTranscriptEntry => ({
    ...entry,
    entryId: `${sessionId}:${entry.entryId}`,
    raw: {
        ...entry.raw,
        sourceSessionId: sessionId,
    },
});

const retainedLineageEntries = (
    transcript: KiroSessionTranscript,
    entries: KiroTranscriptEntry[],
    isRoot: boolean,
): KiroTranscriptEntry[] => {
    const summaryEntryId =
        isRoot || !isContinuationSummaryEntry(transcript.historyEntries[0])
            ? null
            : transcript.historyEntries[0]?.entryId;
    return entries
        .filter((entry) => entry.entryId !== summaryEntryId)
        .map((entry) => namespaceMergedEntry(entry, transcript.session.sessionId));
};

const mergeKiroTranscriptLineage = (
    chain: string[],
    transcriptsById: Map<string, KiroSessionTranscript>,
): KiroSessionTranscript | null => {
    const lineage = chain.flatMap((sessionId) => {
        const transcript = transcriptsById.get(sessionId);
        return transcript ? [transcript] : [];
    });
    const root = lineage[0];
    const latest = lineage.at(-1);
    if (!root || !latest || lineage.length !== chain.length) {
        return null;
    }

    const historyEntries = lineage.flatMap((transcript, index) =>
        retainedLineageEntries(transcript, transcript.historyEntries, index === 0),
    );
    const executionEntries = lineage.flatMap((transcript) =>
        transcript.executionEntries.map((entry) => namespaceMergedEntry(entry, transcript.session.sessionId)),
    );
    const entries = lineage.flatMap((transcript, index) =>
        retainedLineageEntries(transcript, transcript.entries, index === 0),
    );
    const stats = createStatsFromEntries(entries);
    return {
        entries,
        executionEntries,
        historyEntries,
        rawHistory: lineage.flatMap((transcript, index) =>
            index > 0 && isContinuationSummaryEntry(transcript.historyEntries[0])
                ? transcript.rawHistory.slice(1)
                : transcript.rawHistory,
        ),
        rawSession: latest.rawSession,
        renderablePartCount: stats.renderablePartCount,
        session: {
            ...latest.session,
            ...stats,
            continuationSessionIds: chain,
            createdAtIso: root.session.createdAtIso,
            createdAtMs: root.session.createdAtMs,
            filePath: root.session.filePath,
            sessionId: root.session.sessionId,
            title: root.session.title,
        },
    };
};

const mergeKiroContinuationTranscripts = (transcripts: KiroSessionTranscript[]): KiroSessionTranscript[] => {
    const transcriptsById = new Map(transcripts.map((transcript) => [transcript.session.sessionId, transcript]));
    const chains = getUnambiguousContinuationChains(transcripts);
    const continuationSessionIds = new Set(chains.flat());
    return [
        ...chains.flatMap((chain) => {
            const transcript = mergeKiroTranscriptLineage(chain, transcriptsById);
            return transcript ? [transcript] : [];
        }),
        ...transcripts.filter((transcript) => !continuationSessionIds.has(transcript.session.sessionId)),
    ];
};

const getKiroContinuationChainForRoot = (transcripts: KiroSessionTranscript[], sessionId: string): string[] | null => {
    return getUnambiguousContinuationChains(transcripts).find((chain) => chain[0] === sessionId) ?? null;
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
    const transcripts = mergeKiroContinuationTranscripts(await readSessionFiles(files));
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
    return sortSessions(mergeKiroContinuationTranscripts(transcripts).map((transcript) => transcript.session));
};

const locateSessionFile = async (sessionsDir: string, sessionId: string): Promise<KiroSessionFile | null> => {
    const files = await listSessionFiles(sessionsDir);
    const filenameMatch = files.find((file) => path.basename(file.filePath, '.json') === sessionId);
    if (filenameMatch) {
        return filenameMatch;
    }

    const bodyMatches = await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
        const raw = await readJsonObject(file.filePath);
        return asString(raw?.sessionId ?? null) === sessionId ? file : null;
    });
    return bodyMatches.find((file): file is KiroSessionFile => file !== null) ?? null;
};

const removeKiroSessionIndexEntry = async (workspaceDir: string, sessionId: string): Promise<void> => {
    const indexPath = path.join(workspaceDir, 'sessions.json');
    const value = (await Bun.file(indexPath)
        .json()
        .catch(() => null)) as JsonValue | null;
    if (!Array.isArray(value)) {
        return;
    }

    const next = value.filter((item) => asString(asObject(item)?.sessionId ?? null) !== sessionId);
    if (next.length === value.length) {
        return;
    }

    const tempPath = `${indexPath}.${randomUUID()}.tmp`;
    try {
        await Bun.write(tempPath, JSON.stringify(next, null, 2));
        await rename(tempPath, indexPath);
    } finally {
        await rm(tempPath, { force: true });
    }
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

    const physicalTranscript = await readSessionFile(file, { includeExecutions: true, sessionsDir });
    if (!physicalTranscript || getActiveTabIds(physicalTranscript).length > 1) {
        return physicalTranscript;
    }

    const workspaceFiles = await listSessionFilesForWorkspace(sessionsDir, file.directoryName);
    const physicalTranscripts = await readSessionFiles(workspaceFiles);
    const chain = getKiroContinuationChainForRoot(physicalTranscripts, sessionId);
    if (!chain) {
        return physicalTranscript;
    }

    const workspaceFilesByPath = new Map(
        workspaceFiles.map((workspaceFile) => [workspaceFile.filePath, workspaceFile]),
    );
    const physicalFileBySessionId = new Map(
        physicalTranscripts.flatMap((transcript) => {
            const lineageFile = workspaceFilesByPath.get(transcript.session.filePath);
            return lineageFile ? [[transcript.session.sessionId, lineageFile] as const] : [];
        }),
    );
    const detailedLineage = await mapWithConcurrency(chain, READ_CONCURRENCY, async (lineageSessionId) => {
        if (lineageSessionId === sessionId) {
            return physicalTranscript;
        }
        const lineageFile = physicalFileBySessionId.get(lineageSessionId);
        return lineageFile ? readSessionFile(lineageFile, { includeExecutions: true, sessionsDir }) : null;
    });
    const transcriptsById = new Map(
        detailedLineage.flatMap((transcript) =>
            transcript ? [[transcript.session.sessionId, transcript] as const] : [],
        ),
    );
    return mergeKiroTranscriptLineage(chain, transcriptsById);
};

const deletePhysicalKiroSession = async (sessionsDir: string, sessionId: string): Promise<DeleteKiroSessionResult> => {
    const file = await locateSessionFile(sessionsDir, sessionId);
    if (!file) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const transcript = await readSessionFile(file, { includeExecutions: false, sessionsDir });
    const executionFiles = transcript
        ? await listExecutionFilesForSession(
              getKiroDataDirFromSessionsDir(sessionsDir),
              sessionId,
              transcript.session.worktree,
          )
        : [];
    const deletedFiles = [file.filePath, ...executionFiles.map((execution) => execution.filePath)];

    await Promise.all(deletedFiles.map((filePath) => rm(filePath, { force: true })));
    executionFilesCache.delete(
        path.join(getKiroDataDirFromSessionsDir(sessionsDir), getKiroWorkspaceHash(transcript?.session.worktree ?? '')),
    );
    await removeKiroSessionIndexEntry(path.dirname(file.filePath), sessionId);

    return {
        deletedFiles,
        deletedSessionIds: [sessionId],
    };
};

const getKiroDeleteTargetIds = async (sessionsDir: string, sessionId: string): Promise<string[]> => {
    const file = await locateSessionFile(sessionsDir, sessionId);
    if (!file) {
        return [];
    }
    const files = await listSessionFilesForWorkspace(sessionsDir, file.directoryName);
    const transcripts = await readSessionFiles(files);
    return getKiroContinuationChainForRoot(transcripts, sessionId) ?? [sessionId];
};

export const deleteKiroSession = (sessionsDir: string, sessionId: string): Promise<DeleteKiroSessionResult> => {
    return kiroDeleteLimiter(async () => {
        if (!(await pathExists(sessionsDir))) {
            return { deletedFiles: [], deletedSessionIds: [] };
        }

        const targetIds = await getKiroDeleteTargetIds(sessionsDir, sessionId);
        const results: DeleteKiroSessionResult[] = [];
        for (const targetId of targetIds) {
            results.push(await deletePhysicalKiroSession(sessionsDir, targetId));
        }
        return {
            deletedFiles: results.flatMap((result) => result.deletedFiles),
            deletedSessionIds: results.flatMap((result) => result.deletedSessionIds),
        };
    });
};
