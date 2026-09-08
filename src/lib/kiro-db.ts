import { randomUUID } from 'node:crypto';
import { readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createBoundedFileCache } from './bounded-file-cache';
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
import {
    mergeKiroTranscriptEntries,
    parseKiroExecutionEntries,
    parseKiroHistoryEntry,
    parseTimestampMs,
    toIso,
} from './kiro-transcript-parser';
import { getPortablePathBasename } from './portable-path';
import { isWorkspacePathQuery, readDirectoryEntriesIfExists, workspacePathMatchesQuery } from './shared';
import {
    asObject,
    asString,
    cleanExtractedText,
    cleanInlineTitle,
    type JsonValue,
    warnParserDiagnosticOnce,
} from './shared-text';

export { getDefaultKiroDataDir, resolveKiroWorkspaceSessionsDir };

const READ_CONCURRENCY = 8;
const EXECUTION_INDEX_READ_CONCURRENCY = 1;
const DELETE_CONCURRENCY = 1;
const EXECUTION_CACHE_TTL_MS = 1_000;
const EXECUTION_CACHE_MAX_ENTRIES = 128;
const SESSION_INDEX_CACHE_TTL_MS = 1_000;
const SESSION_INDEX_CACHE_MAX_ENTRIES = 256;
const TRANSCRIPT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const TRANSCRIPT_CACHE_MAX_ENTRIES = 256;
const WORKSPACE_KEY_PREFIX = 'workspace:';
const kiroDeleteLimiter = createConcurrencyLimiter(DELETE_CONCURRENCY);
const executionIndexCache = new Map<
    string,
    { expiresAtMs: number; filesBySessionId: Map<string, KiroExecutionFileReference[]> }
>();
const executionIndexInFlight = new Map<string, Promise<Map<string, KiroExecutionFileReference[]>>>();
const transcriptFileCache = createBoundedFileCache<KiroSessionTranscript>({
    maxBytes: TRANSCRIPT_CACHE_MAX_BYTES,
    maxEntries: TRANSCRIPT_CACHE_MAX_ENTRIES,
});
const sessionIndexCache = new Map<string, { expiresAtMs: number; files: KiroSessionFile[] }>();
const sessionIndexInFlight = new Map<string, Promise<KiroSessionFile[]>>();
let sessionIndexGeneration = 0;
let executionIndexGeneration = 0;

const pruneSessionIndexCache = (nowMs: number): void => {
    for (const [key, entry] of sessionIndexCache) {
        if (entry.expiresAtMs <= nowMs) {
            sessionIndexCache.delete(key);
        }
    }
};

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

type KiroExecutionFileReference = {
    filePath: string;
    sessionId: string;
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

export const invalidateKiroDiscoveryCache = (filePaths: string[] = []): void => {
    executionIndexGeneration += 1;
    sessionIndexGeneration += 1;
    sessionIndexCache.clear();
    sessionIndexInFlight.clear();
    executionIndexCache.clear();
    executionIndexInFlight.clear();
    for (const filePath of filePaths) {
        transcriptFileCache.invalidate(filePath);
    }
};

const pathExists = async (target: string): Promise<boolean> => {
    return await stat(target)
        .then(() => true)
        .catch(() => false);
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

const readJsonObject = async (
    filePath: string,
    diagnoseMalformed = true,
): Promise<Record<string, JsonValue> | null> => {
    try {
        const object = asObject((await Bun.file(filePath).json()) as JsonValue);
        if (!object && diagnoseMalformed) {
            warnParserDiagnosticOnce('kiro', 'schema-mismatch', { expected: 'object', filePath });
        }
        return object;
    } catch (error) {
        if (diagnoseMalformed && (error as { code?: unknown }).code !== 'ENOENT') {
            warnParserDiagnosticOnce('kiro', 'malformed-json', { filePath });
        }
        return null;
    }
};

const readSessionIndex = async (workspaceDir: string): Promise<Map<string, KiroSessionIndexEntry>> => {
    const indexPath = path.join(workspaceDir, 'sessions.json');
    let value: JsonValue | null = null;
    try {
        value = (await Bun.file(indexPath).json()) as JsonValue;
    } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT') {
            warnParserDiagnosticOnce('kiro', 'malformed-json', { filePath: indexPath });
        }
    }
    if (value !== null && !Array.isArray(value)) {
        warnParserDiagnosticOnce('kiro', 'schema-mismatch', { expected: 'array', filePath: indexPath });
    }
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

const listFilesRecursively = async (root: string, excludedRoot: string): Promise<string[]> => {
    const directories = [root];
    const files: string[] = [];

    while (directories.length > 0) {
        const batch = directories.splice(0, READ_CONCURRENCY);
        const entriesByDirectory = await Promise.all(
            batch.map(async (directory) => ({
                directory,
                entries: await readDirectoryEntriesIfExists(directory),
            })),
        );
        for (const { directory, entries } of entriesByDirectory) {
            for (const entry of entries) {
                const entryPath = path.join(directory, entry.name);
                if (entry.isFile()) {
                    files.push(entryPath);
                } else if (entry.isDirectory() && entryPath !== excludedRoot) {
                    directories.push(entryPath);
                }
            }
        }
    }

    return files;
};

const buildExecutionIndex = async (dataDir: string): Promise<Map<string, KiroExecutionFileReference[]>> => {
    const files = await listFilesRecursively(dataDir, path.join(dataDir, 'workspace-sessions'));
    const executions = await mapWithConcurrency(files, EXECUTION_INDEX_READ_CONCURRENCY, async (filePath) => {
        const raw = await readJsonObject(filePath, false);
        const sessionId = asString(raw?.chatSessionId ?? null);
        return raw && sessionId && Array.isArray(raw.actions) ? { filePath, sessionId } : null;
    });
    const filesBySessionId = new Map<string, KiroExecutionFileReference[]>();
    for (const item of executions) {
        if (!item) {
            continue;
        }
        const sessionFiles = filesBySessionId.get(item.sessionId) ?? [];
        sessionFiles.push({ filePath: item.filePath, sessionId: item.sessionId });
        filesBySessionId.set(item.sessionId, sessionFiles);
    }
    return filesBySessionId;
};

const getExecutionIndex = async (dataDir: string): Promise<Map<string, KiroExecutionFileReference[]>> => {
    const nowMs = Date.now();
    for (const [key, entry] of executionIndexCache) {
        if (entry.expiresAtMs <= nowMs) {
            executionIndexCache.delete(key);
        }
    }
    const cached = executionIndexCache.get(dataDir);
    if (cached) {
        executionIndexCache.delete(dataDir);
        executionIndexCache.set(dataDir, cached);
        return cached.filesBySessionId;
    }
    const pending = executionIndexInFlight.get(dataDir);
    if (pending) {
        return pending;
    }

    const generation = executionIndexGeneration;
    const load = buildExecutionIndex(dataDir);
    executionIndexInFlight.set(dataDir, load);
    try {
        const filesBySessionId = await load;
        if (generation === executionIndexGeneration) {
            while (executionIndexCache.size >= EXECUTION_CACHE_MAX_ENTRIES) {
                const oldestKey = executionIndexCache.keys().next().value;
                if (typeof oldestKey !== 'string') {
                    break;
                }
                executionIndexCache.delete(oldestKey);
            }
            executionIndexCache.set(dataDir, {
                expiresAtMs: Date.now() + EXECUTION_CACHE_TTL_MS,
                filesBySessionId,
            });
        }
        return filesBySessionId;
    } finally {
        if (executionIndexInFlight.get(dataDir) === load) {
            executionIndexInFlight.delete(dataDir);
        }
    }
};

const listExecutionFileReferencesForSession = async (
    dataDir: string,
    sessionId: string,
): Promise<KiroExecutionFileReference[]> => (await getExecutionIndex(dataDir)).get(sessionId) ?? [];

const isExpectedExecutionFilePath = (dataDir: string, filePath: string): boolean => {
    const relativePath = path.relative(dataDir, filePath);
    if (
        !relativePath ||
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        return false;
    }
    const rootDirectory = relativePath.split(path.sep)[0];
    return rootDirectory === 'executions' || /^[a-f\d]{32}$/iu.test(rootDirectory ?? '');
};

const listVerifiedExecutionFilesForDeletion = async (dataDir: string, sessionId: string): Promise<string[]> => {
    const references = await listExecutionFileReferencesForSession(dataDir, sessionId);
    const verifiedPaths = await mapWithConcurrency(references, READ_CONCURRENCY, async ({ filePath }) => {
        if (!isExpectedExecutionFilePath(dataDir, filePath)) {
            return null;
        }
        const raw = await readJsonObject(filePath, false);
        return raw && asString(raw.chatSessionId ?? null) === sessionId && Array.isArray(raw.actions) ? filePath : null;
    });
    return verifiedPaths.filter((filePath): filePath is string => filePath !== null);
};

const parseExecutionEntries = (execution: KiroExecutionFile): KiroTranscriptEntry[] =>
    parseKiroExecutionEntries(execution.raw, execution.filePath);

const compareExecutionFiles = (left: KiroExecutionFile, right: KiroExecutionFile): number => {
    return (
        (parseTimestampMs(left.raw.startTime) ?? 0) - (parseTimestampMs(right.raw.startTime) ?? 0) ||
        left.filePath.localeCompare(right.filePath)
    );
};

const readExecutionFiles = async (sessionsDir: string, session: KiroSessionSummary): Promise<KiroExecutionFile[]> => {
    const executionReferences = await listExecutionFileReferencesForSession(
        getKiroDataDirFromSessionsDir(sessionsDir),
        session.sessionId,
    );
    const executions = await mapWithConcurrency(
        executionReferences,
        READ_CONCURRENCY,
        async ({ filePath, sessionId }) => {
            const raw = await readJsonObject(filePath, false);
            return raw &&
                sessionId === session.sessionId &&
                asString(raw.chatSessionId ?? null) === sessionId &&
                Array.isArray(raw.actions)
                ? { filePath, raw }
                : null;
        },
    );
    return executions
        .filter((execution): execution is KiroExecutionFile => execution !== null)
        .sort(compareExecutionFiles);
};

const createStatsFromEntries = (entries: KiroTranscriptEntry[]): SessionStats => {
    const stats = createEmptyStats();
    for (const entry of entries) {
        updateStatsFromEntry(stats, entry);
    }
    return stats;
};

const parseSessionFile = async (
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

        const entry = parseKiroHistoryEntry(raw, index);
        if (!entry) {
            return;
        }

        historyEntries.push(entry);
        updateIdentityFromEntry(identity, entry);
    });

    const baseSummary = toSessionSummary(file, identity, createEmptyStats(), fileStats);
    const executionFiles = options.includeExecutions ? await readExecutionFiles(options.sessionsDir, baseSummary) : [];
    const executionEntries = executionFiles.flatMap(parseExecutionEntries);
    const entries = mergeKiroTranscriptEntries(historyEntries, executionEntries);
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

const readSessionFile = async (
    file: KiroSessionFile,
    options: ReadSessionFileOptions,
): Promise<KiroSessionTranscript | null> => {
    if (options.includeExecutions) {
        return parseSessionFile(file, options);
    }

    return transcriptFileCache.read(
        file.filePath,
        () => parseSessionFile(file, { ...options, includeExecutions: false }),
        JSON.stringify(file.indexEntry),
    );
};

const scanSessionFilesForWorkspace = async (sessionsDir: string, directoryName: string): Promise<KiroSessionFile[]> => {
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

const getCachedSessionFiles = async (
    cacheKey: string,
    loader: () => Promise<KiroSessionFile[]>,
): Promise<KiroSessionFile[]> => {
    const nowMs = Date.now();
    pruneSessionIndexCache(nowMs);
    const cached = sessionIndexCache.get(cacheKey);
    if (cached) {
        sessionIndexCache.delete(cacheKey);
        sessionIndexCache.set(cacheKey, cached);
        return cached.files;
    }

    const pending = sessionIndexInFlight.get(cacheKey);
    if (pending) {
        return pending;
    }

    const generation = sessionIndexGeneration;
    const load = loader();
    sessionIndexInFlight.set(cacheKey, load);
    try {
        const files = await load;
        if (generation === sessionIndexGeneration) {
            while (sessionIndexCache.size >= SESSION_INDEX_CACHE_MAX_ENTRIES) {
                const oldestKey = sessionIndexCache.keys().next().value;
                if (typeof oldestKey !== 'string') {
                    break;
                }
                sessionIndexCache.delete(oldestKey);
            }
            sessionIndexCache.set(cacheKey, { expiresAtMs: Date.now() + SESSION_INDEX_CACHE_TTL_MS, files });
        }
        return files;
    } finally {
        if (sessionIndexInFlight.get(cacheKey) === load) {
            sessionIndexInFlight.delete(cacheKey);
        }
    }
};

const listSessionFilesForWorkspace = async (sessionsDir: string, directoryName: string): Promise<KiroSessionFile[]> =>
    getCachedSessionFiles(`${sessionsDir}\0workspace:${directoryName}`, () =>
        scanSessionFilesForWorkspace(sessionsDir, directoryName),
    );

const scanSessionFiles = async (sessionsDir: string): Promise<KiroSessionFile[]> => {
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

const listSessionFiles = async (sessionsDir: string): Promise<KiroSessionFile[]> =>
    getCachedSessionFiles(`all:${sessionsDir}`, () => scanSessionFiles(sessionsDir));

const readSessionFiles = async (files: KiroSessionFile[]): Promise<KiroSessionTranscript[]> => {
    const transcripts = await mapWithConcurrency(files, READ_CONCURRENCY, (file) =>
        readSessionFile(file, { includeExecutions: false, sessionsDir: path.dirname(path.dirname(file.filePath)) }),
    );
    return transcripts.flatMap((transcript) => (transcript && transcript.renderablePartCount > 0 ? [transcript] : []));
};

const getSessionFileId = (file: KiroSessionFile): string => {
    return file.indexEntry?.sessionId ?? path.basename(file.filePath, '.json');
};

const isKiroSessionFileWithinUpdateWindow = (
    mtimeMs: number | null,
    indexEntry: KiroSessionIndexEntry | null,
    options: { updatedAfterMs?: number; updatedBeforeMs?: number },
): boolean => {
    const updatedAtMs = mtimeMs ?? indexEntry?.createdAtMs ?? 0;
    return (
        (options.updatedAfterMs === undefined || updatedAtMs >= options.updatedAfterMs) &&
        (options.updatedBeforeMs === undefined || updatedAtMs <= options.updatedBeforeMs)
    );
};

const filterKiroSessionFilesByUpdateWindow = async (
    files: KiroSessionFile[],
    options: { updatedAfterMs?: number; updatedBeforeMs?: number },
): Promise<KiroSessionFile[]> => {
    if (options.updatedAfterMs === undefined) {
        return files;
    }

    const candidates = await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
        const mtimeMs = await stat(file.filePath)
            .then((fileStat) => fileStat.mtimeMs)
            .catch(() => null);
        // Keep upper bounds for the post-merge filter so newer continuation children can exclude their roots.
        return isKiroSessionFileWithinUpdateWindow(mtimeMs, file.indexEntry, {
            updatedAfterMs: options.updatedAfterMs,
        })
            ? file
            : null;
    });
    return candidates.filter((file): file is KiroSessionFile => file !== null);
};

const readKiroSessionFilesForUpdateWindow = async (
    files: KiroSessionFile[],
    options: { updatedAfterMs?: number; updatedBeforeMs?: number },
): Promise<KiroSessionTranscript[]> => {
    const candidates = await filterKiroSessionFilesByUpdateWindow(files, options);
    if (candidates.length === files.length) {
        return readSessionFiles(files);
    }

    const filesBySessionId = new Map(files.map((file) => [getSessionFileId(file), file]));
    const hydratedPaths = new Set<string>();
    const transcripts: KiroSessionTranscript[] = [];
    let pendingFiles = candidates;
    while (pendingFiles.length > 0) {
        for (const file of pendingFiles) {
            hydratedPaths.add(file.filePath);
        }
        transcripts.push(...(await readSessionFiles(pendingFiles)));
        const continuationIds = new Set(transcripts.flatMap(getActiveTabIds));
        pendingFiles = [...continuationIds]
            .map((sessionId) => filesBySessionId.get(sessionId))
            .filter((file): file is KiroSessionFile => Boolean(file && !hydratedPaths.has(file.filePath)));
    }

    return transcripts;
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
    options: { updatedAfterMs?: number; updatedBeforeMs?: number } = {},
): Promise<KiroSessionSummary[]> => {
    const directoryName = getDirectoryNameFromWorkspaceKey(workspaceKey);
    if (!directoryName || !(await pathExists(sessionsDir))) {
        return [];
    }

    const files = await listSessionFilesForWorkspace(sessionsDir, directoryName);
    const transcripts = await readKiroSessionFilesForUpdateWindow(files, options);
    const sessions = mergeKiroContinuationTranscripts(transcripts).map((transcript) => transcript.session);
    return sortSessions(
        sessions.filter((session) => isKiroSessionFileWithinUpdateWindow(session.lastActiveAtMs, null, options)),
    );
};

const locateSessionFile = async (sessionsDir: string, sessionId: string): Promise<KiroSessionFile | null> => {
    const workspaceDirs = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of workspaceDirs) {
        if (!entry.isDirectory()) {
            continue;
        }
        const filePath = path.join(sessionsDir, entry.name, `${sessionId}.json`);
        if (await pathExists(filePath)) {
            const index = await readSessionIndex(path.dirname(filePath));
            return {
                directoryName: entry.name,
                filePath,
                indexEntry: index.get(sessionId) ?? null,
            };
        }
    }

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

export const findKiroTranscriptPath = async (sessionsDir: string, sessionId: string): Promise<string | null> => {
    return (await locateSessionFile(sessionsDir, sessionId))?.filePath ?? null;
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
    const dataDir = getKiroDataDirFromSessionsDir(sessionsDir);
    const executionFiles = transcript ? await listVerifiedExecutionFilesForDeletion(dataDir, sessionId) : [];
    const deletedFiles = [file.filePath, ...executionFiles];

    await Promise.all(deletedFiles.map((filePath) => rm(filePath, { force: true })));
    executionIndexCache.delete(dataDir);
    await removeKiroSessionIndexEntry(path.dirname(file.filePath), sessionId);
    invalidateKiroDiscoveryCache([file.filePath]);

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
