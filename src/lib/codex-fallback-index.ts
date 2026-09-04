import { closeSync, openSync, readdirSync, readSync, type Stats, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { DynamicToolRow } from './codex-browser-types';
import {
    compareThreadsByRecentActivity,
    getThreadUpdatedAtMs,
    resolveCodexDirFromDbPath,
    resolveCodexRolloutPath,
} from './codex-database';
import type { ThreadRow } from './codex-thread-types';
import { mapWithConcurrency } from './concurrency';
import { getConversationPathMatch } from './conversation-data/path-match';
import { getPortablePathBasename } from './portable-path';

type ActivityTimestampedThread = {
    id: string;
    rollout_path: string;
    updated_at: number;
    updated_at_ms: number | null;
};

type SessionIndexEntry = {
    id: string;
    thread_name?: string;
    updated_at?: string;
};

type FallbackSessionMeta = {
    agent_nickname?: string;
    agent_path?: string;
    agent_role?: string;
    cli_version?: string;
    cwd?: string;
    dynamic_tools?: unknown;
    forked_from_id?: string;
    id?: string;
    model_provider?: string;
    parent_thread_id?: string;
    source?: unknown;
    thread_source?: string;
    timestamp?: string;
};

type ReadFallbackThreadRowsOptions = {
    includeSubagents?: boolean;
};

type FallbackRolloutStats = {
    model: string | null;
    tokensUsed: number;
};

type FallbackThreadRowOptions = ReadFallbackThreadRowsOptions & {
    projectName?: string | null;
};

const JSONL_READ_CHUNK_BYTES = 64 * 1024;
const SESSION_META_READ_CHUNK_BYTES = 64 * 1024;
const SESSION_META_READ_LIMIT_BYTES = 4 * 1024 * 1024;
const FALLBACK_STATS_HEAD_READ_LIMIT_BYTES = 512 * 1024;
const FALLBACK_STATS_TAIL_READ_LIMIT_BYTES = 512 * 1024;
const FALLBACK_STATS_RECORD_PATTERN = /"type"\s*:\s*"(?:agent_message|message|token_count|turn_context)"/u;
const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu;
const THREAD_LIST_IO_CONCURRENCY = 8;

const sessionFileIndexCache = new Map<string, { fingerprint: string; sessionFilesByThreadId: Map<string, string> }>();
const sessionIndexEntriesCache = new Map<string, { entries: SessionIndexEntry[]; fingerprint: string }>();
const fallbackThreadRowCache = new Map<
    string,
    { fingerprint: string; row: ThreadRow | null; sessionMeta: FallbackSessionMeta | null }
>();
const parseJsonlObject = <T>(line: string): T | null => {
    try {
        return JSON.parse(line) as T;
    } catch {
        return null;
    }
};

const emitJsonlLine = <T>(line: string, onRecord: (record: T) => void) => {
    const trimmed = line.trim();
    const parsed = trimmed ? parseJsonlObject<T>(trimmed) : null;
    if (parsed) {
        onRecord(parsed);
    }
};

const emitCompleteJsonlLines = <T>(text: string, onRecord: (record: T) => void): string => {
    const lines = text.split(/\r?\n/u);
    const pending = lines.pop() ?? '';
    for (const line of lines) {
        emitJsonlLine(line, onRecord);
    }
    return pending;
};

const readJsonlObjects = <T>(filePath: string, onRecord: (record: T) => void) => {
    let descriptor: number | null = null;
    try {
        const stats = statSync(filePath);
        if (!stats.isFile()) {
            return;
        }

        descriptor = openSync(filePath, 'r');
        const buffer = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        let position = 0;
        let pending = '';

        while (true) {
            const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
            if (bytesRead === 0) {
                break;
            }

            position += bytesRead;
            pending += decoder.write(buffer.subarray(0, bytesRead));
            pending = emitCompleteJsonlLines(pending, onRecord);
        }

        emitJsonlLine(pending + decoder.end(), onRecord);
    } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return;
        }
        throw error;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
};

const collectJsonlObjects = <T>(filePath: string): T[] => {
    const records: T[] = [];
    readJsonlObjects<T>(filePath, (record) => {
        records.push(record);
    });
    return records;
};

export const readSessionIndexEntries = (codexDir: string): SessionIndexEntry[] => {
    const sessionIndexPath = path.join(codexDir, 'session_index.jsonl');
    let fingerprint = 'missing';
    try {
        const metadata = statSync(sessionIndexPath);
        fingerprint = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.ino}`;
    } catch {}
    const cached = sessionIndexEntriesCache.get(codexDir);
    if (cached?.fingerprint === fingerprint) {
        return cached.entries;
    }

    const entries = collectJsonlObjects<SessionIndexEntry>(sessionIndexPath).filter(
        (entry) => typeof entry.id === 'string' && entry.id.length > 0,
    );
    sessionIndexEntriesCache.set(codexDir, { entries, fingerprint });
    return entries;
};

const getSessionIndexThreadNamesById = (codexDir: string, suppliedEntries?: SessionIndexEntry[]) => {
    const threadNamesById = new Map<string, string>();
    for (const entry of suppliedEntries ?? readSessionIndexEntries(codexDir)) {
        const threadName = entry.thread_name?.trim();
        if (threadName) {
            threadNamesById.set(entry.id, threadName);
        }
    }
    return threadNamesById;
};

export const applySessionIndexThreadNames = <T extends { id: string; title: string }>(
    dbPath: string,
    threads: T[],
    suppliedThreadNamesById?: Map<string, string>,
): T[] => {
    const threadNamesById =
        suppliedThreadNamesById ?? getSessionIndexThreadNamesById(resolveCodexDirFromDbPath(dbPath));
    return threads.map((thread) => {
        const threadName = threadNamesById.get(thread.id);
        return threadName ? { ...thread, title: threadName } : thread;
    });
};

const collectSessionFilesByThreadId = (sessionsDir: string): Map<string, string> => {
    const ambiguousThreadIds = new Set<string>();
    const sessionFiles = new Map<string, string>();
    const recordSessionFile = (fileName: string, filePath: string) => {
        const threadId = THREAD_ID_PATTERN.exec(fileName)?.[1];
        if (!threadId || ambiguousThreadIds.has(threadId)) {
            return;
        }
        if (sessionFiles.has(threadId)) {
            sessionFiles.delete(threadId);
            ambiguousThreadIds.add(threadId);
        } else {
            sessionFiles.set(threadId, filePath);
        }
    };
    const visit = (directory: string) => {
        const entries = (() => {
            try {
                return readdirSync(directory, { withFileTypes: true });
            } catch {
                return null;
            }
        })();
        if (!entries) {
            return;
        }

        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(entryPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            recordSessionFile(entry.name, entryPath);
        }
    };

    visit(sessionsDir);
    return sessionFiles;
};

const getSessionFileIndexFingerprint = (sessionsDir: string) => {
    const toFingerprintPart = (targetPath: string) => {
        try {
            const metadata = statSync(targetPath);
            return `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.ino}`;
        } catch {
            return 'missing';
        }
    };

    return `${toFingerprintPart(path.join(path.dirname(sessionsDir), 'session_index.jsonl'))}:${toFingerprintPart(
        sessionsDir,
    )}`;
};

export const getSessionFilesByThreadId = (
    sessionsDir: string,
    fingerprint = getSessionFileIndexFingerprint(sessionsDir),
) => {
    const cached = sessionFileIndexCache.get(sessionsDir);
    if (cached?.fingerprint === fingerprint) {
        return cached.sessionFilesByThreadId;
    }

    const sessionFilesByThreadId = collectSessionFilesByThreadId(sessionsDir);
    sessionFileIndexCache.set(sessionsDir, {
        fingerprint,
        sessionFilesByThreadId,
    });
    return sessionFilesByThreadId;
};

export const findSessionFileByThreadId = (sessionsDir: string, threadId: string): string | null => {
    const lookup = (sessionFilesByThreadId: Map<string, string>) => {
        const sessionFile = sessionFilesByThreadId.get(threadId);
        if (!sessionFile) {
            return null;
        }

        try {
            return statSync(sessionFile).isFile() ? sessionFile : null;
        } catch {
            return null;
        }
    };

    return lookup(getSessionFilesByThreadId(sessionsDir));
};

const readSessionMetaLine = (sessionFile: string): string | null => {
    let descriptor: number | null = null;
    try {
        descriptor = openSync(sessionFile, 'r');
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        while (totalBytes < SESSION_META_READ_LIMIT_BYTES) {
            const buffer = Buffer.alloc(
                Math.min(SESSION_META_READ_CHUNK_BYTES, SESSION_META_READ_LIMIT_BYTES - totalBytes),
            );
            const bytesRead = readSync(descriptor, buffer, 0, buffer.length, totalBytes);
            if (bytesRead === 0) {
                break;
            }

            chunks.push(buffer.subarray(0, bytesRead));
            totalBytes += bytesRead;
            if (buffer.subarray(0, bytesRead).includes(10)) {
                break;
            }
        }

        const firstLine = Buffer.concat(chunks).toString('utf8').split(/\r?\n/u)[0]?.trim();
        return firstLine || null;
    } catch {
        return null;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
};

export const readFallbackSessionMeta = (sessionFile: string): FallbackSessionMeta | null => {
    const line = readSessionMetaLine(sessionFile);
    if (!line) {
        return null;
    }

    try {
        const record = JSON.parse(line) as { payload?: FallbackSessionMeta; type?: string };
        return record.type === 'session_meta' && record.payload ? record.payload : null;
    } catch {
        return null;
    }
};

const parseIsoMs = (value: string | undefined, fallback: number) => {
    if (!value) {
        return fallback;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const stringOrNull = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const objectOrNull = (value: unknown) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
};

export const parseFallbackDynamicTools = (sessionMeta: FallbackSessionMeta, threadId: string): DynamicToolRow[] => {
    if (!Array.isArray(sessionMeta.dynamic_tools)) {
        return [];
    }

    return sessionMeta.dynamic_tools.flatMap((value, position) => {
        const tool = objectOrNull(value);
        if (!tool) {
            return [];
        }

        return [
            {
                deferLoading: tool.deferLoading === true || tool.defer_loading === true,
                description: stringOrNull(tool.description) ?? '',
                inputSchema: (objectOrNull(tool.inputSchema) ??
                    objectOrNull(tool.input_schema)) as DynamicToolRow['inputSchema'],
                name: stringOrNull(tool.name) ?? 'unknown',
                namespace: stringOrNull(tool.namespace),
                position,
                threadId,
            },
        ];
    });
};

export const isFallbackSubagent = (sessionMeta: FallbackSessionMeta) => {
    return Boolean(
        sessionMeta.thread_source === 'subagent' ||
            stringOrNull(sessionMeta.parent_thread_id) ||
            stringOrNull(sessionMeta.forked_from_id),
    );
};

const updateFallbackRolloutStatsFromRecord = (record: Record<string, unknown>, stats: FallbackRolloutStats): void => {
    const payload = objectOrNull(record.payload);
    if (!payload) {
        return;
    }

    if (record.type === 'turn_context') {
        stats.model = stringOrNull(payload.model) ?? stats.model;
        return;
    }

    const payloadType = stringOrNull(payload.type);
    if (payloadType === 'message' || payloadType === 'agent_message') {
        stats.model = stringOrNull(payload.model) ?? stats.model;
        return;
    }

    if (payloadType !== 'token_count') {
        return;
    }

    const info = objectOrNull(payload.info);
    const totalTokenUsage = objectOrNull(info?.total_token_usage);
    stats.tokensUsed = numberOrNull(totalTokenUsage?.total_tokens) ?? stats.tokensUsed;
};

const readFallbackStatsLine = (line: string, stats: FallbackRolloutStats) => {
    const trimmed = line.trim();
    if (!trimmed || !FALLBACK_STATS_RECORD_PATTERN.test(trimmed)) {
        return;
    }

    const record = parseJsonlObject<Record<string, unknown>>(trimmed);
    if (record) {
        updateFallbackRolloutStatsFromRecord(record, stats);
    }
};

const emitCompleteFallbackStatsLines = (text: string, stats: FallbackRolloutStats): string => {
    const lines = text.split(/\r?\n/u);
    const pending = lines.pop() ?? '';
    for (const line of lines) {
        readFallbackStatsLine(line, stats);
    }
    return pending;
};

const readFallbackRolloutStatsHead = (sessionFile: string, stats: FallbackRolloutStats, fileStats: Stats) => {
    let descriptor: number | null = null;
    try {
        if (!fileStats.isFile()) {
            return 0;
        }

        descriptor = openSync(sessionFile, 'r');
        const buffer = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        const readLimitBytes = Math.min(fileStats.size, FALLBACK_STATS_HEAD_READ_LIMIT_BYTES);
        let position = 0;
        let pending = '';

        while (position < readLimitBytes) {
            const bytesRead = readSync(
                descriptor,
                buffer,
                0,
                Math.min(buffer.length, readLimitBytes - position),
                position,
            );
            if (bytesRead === 0) {
                break;
            }
            position += bytesRead;
            pending += decoder.write(buffer.subarray(0, bytesRead));
            pending = emitCompleteFallbackStatsLines(pending, stats);
        }

        if (position >= fileStats.size) {
            readFallbackStatsLine(pending + decoder.end(), stats);
            return position;
        }

        const partialLine = pending + decoder.end();
        return Math.max(0, position - Buffer.byteLength(partialLine, 'utf8'));
    } catch {
        return 0;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
};

const trimPartialLeadingJsonlLine = (text: string) => {
    if (text.startsWith('\r\n')) {
        return text.slice(2);
    }

    if (text.startsWith('\n')) {
        return text.slice(1);
    }

    const match = /\r?\n/u.exec(text);
    return match ? text.slice(match.index + match[0].length) : '';
};

const readFallbackRolloutStatsTail = (
    sessionFile: string,
    stats: FallbackRolloutStats,
    fileStats: Stats,
    coveredPrefixBytes: number,
) => {
    let descriptor: number | null = null;
    try {
        if (!fileStats.isFile() || fileStats.size === 0) {
            return;
        }

        const suffixStart = Math.max(coveredPrefixBytes, fileStats.size - FALLBACK_STATS_TAIL_READ_LIMIT_BYTES);
        if (suffixStart >= fileStats.size) {
            return;
        }

        const readStart = suffixStart > 0 ? suffixStart - 1 : 0;
        const readLimitBytes = fileStats.size - readStart;
        descriptor = openSync(sessionFile, 'r');
        const buffer = Buffer.alloc(JSONL_READ_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        let position = readStart;
        let remainingBytes = readLimitBytes;
        let text = '';

        while (remainingBytes > 0) {
            const bytesRead = readSync(descriptor, buffer, 0, Math.min(buffer.length, remainingBytes), position);
            if (bytesRead === 0) {
                break;
            }

            position += bytesRead;
            remainingBytes -= bytesRead;
            text += decoder.write(buffer.subarray(0, bytesRead));
        }

        text += decoder.end();
        const completeText = readStart > 0 ? trimPartialLeadingJsonlLine(text) : text;
        for (const line of completeText.split(/\r?\n/u)) {
            readFallbackStatsLine(line, stats);
        }
    } catch {
        return;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
};

const readFallbackRolloutStats = (sessionFile: string, knownFileStats?: Stats): FallbackRolloutStats => {
    const stats: FallbackRolloutStats = {
        model: null,
        tokensUsed: 0,
    };

    try {
        const fileStats = knownFileStats ?? statSync(sessionFile);
        if (!fileStats.isFile()) {
            return stats;
        }

        const coveredPrefixBytes = readFallbackRolloutStatsHead(sessionFile, stats, fileStats);
        readFallbackRolloutStatsTail(sessionFile, stats, fileStats, coveredPrefixBytes);
    } catch {
        return stats;
    }

    return stats;
};

const buildFallbackThreadRow = (
    entry: SessionIndexEntry,
    sessionFile: string,
    sessionMeta: FallbackSessionMeta,
    rolloutStats: FallbackRolloutStats,
    rolloutMtimeMs: number,
): ThreadRow | null => {
    const cwd = stringOrNull(sessionMeta.cwd);
    if (!cwd) {
        return null;
    }

    const updatedAtMs = parseIsoMs(entry.updated_at, rolloutMtimeMs);
    const createdAtMs = parseIsoMs(sessionMeta.timestamp, updatedAtMs);
    const title = entry.thread_name?.trim() || path.basename(sessionFile, '.jsonl');
    const source = stringOrNull(sessionMeta.source) ?? 'session_file';

    return {
        agent_nickname: sessionMeta.agent_nickname ?? null,
        agent_path: sessionMeta.agent_path ?? null,
        agent_role: sessionMeta.agent_role ?? null,
        approval_mode: 'unknown',
        archived: 0,
        archived_at: null,
        cli_version: sessionMeta.cli_version ?? '',
        created_at: Math.floor(createdAtMs / 1000),
        created_at_ms: Math.floor(createdAtMs),
        cwd,
        first_user_message: title,
        git_branch: null,
        git_origin_url: null,
        git_sha: null,
        has_user_event: sessionMeta.thread_source === 'user' ? 1 : 0,
        id: entry.id,
        memory_mode: 'enabled',
        model: rolloutStats.model,
        model_provider: sessionMeta.model_provider ?? 'unknown',
        preview: title,
        reasoning_effort: null,
        rollout_path: sessionFile,
        sandbox_policy: '{}',
        source,
        thread_source: sessionMeta.thread_source ?? null,
        title,
        tokens_used: rolloutStats.tokensUsed,
        updated_at: Math.floor(updatedAtMs / 1000),
        updated_at_ms: Math.floor(updatedAtMs),
    };
};

export const readFallbackThreadRow = (
    entry: SessionIndexEntry,
    sessionFile: string,
    options: FallbackThreadRowOptions = {},
): ThreadRow | null => {
    let fileStats: Stats;
    try {
        fileStats = statSync(sessionFile);
    } catch {
        return null;
    }
    const fingerprint = `${fileStats.size}:${fileStats.mtimeMs}:${entry.thread_name ?? ''}:${entry.updated_at ?? ''}`;
    const cached = fallbackThreadRowCache.get(sessionFile);
    const sessionMeta = cached?.fingerprint === fingerprint ? cached.sessionMeta : readFallbackSessionMeta(sessionFile);
    if (!sessionMeta) {
        fallbackThreadRowCache.set(sessionFile, { fingerprint, row: null, sessionMeta: null });
        return null;
    }

    if (!options.includeSubagents && isFallbackSubagent(sessionMeta)) {
        return null;
    }

    const cwd = stringOrNull(sessionMeta.cwd);
    if (!cwd || (options.projectName && getPortablePathBasename(cwd) !== options.projectName)) {
        return null;
    }

    if (cached?.fingerprint === fingerprint) {
        return cached.row;
    }

    const row = buildFallbackThreadRow(
        entry,
        sessionFile,
        sessionMeta,
        readFallbackRolloutStats(sessionFile, fileStats),
        fileStats.mtimeMs,
    );
    fallbackThreadRowCache.set(sessionFile, { fingerprint, row, sessionMeta });
    return row;
};

export const readFallbackThreadRows = (
    dbPath: string,
    existingThreadIds: Set<string>,
    projectName: string | null = null,
    options: ReadFallbackThreadRowsOptions = {},
): ThreadRow[] => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const sessionFilesByThreadId = getSessionFilesByThreadId(path.join(codexDir, 'sessions'));
    const fallbackThreads: ThreadRow[] = [];

    for (const entry of readSessionIndexEntries(codexDir)) {
        if (existingThreadIds.has(entry.id)) {
            continue;
        }

        const sessionFile = sessionFilesByThreadId.get(entry.id);
        if (!sessionFile) {
            continue;
        }

        const fallbackThread = readFallbackThreadRow(entry, sessionFile, {
            ...options,
            projectName,
        });
        if (!fallbackThread) {
            continue;
        }

        fallbackThreads.push(fallbackThread);
    }

    return fallbackThreads;
};

export type BrowseFilesystemData = {
    sessionFilesByThreadId: Map<string, string>;
    sessionIndexEntries: SessionIndexEntry[];
    sessionIndexThreadNames: Map<string, string>;
};

export const readBrowseFilesystemData = (dbPath: string): BrowseFilesystemData => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const sessionsDir = path.join(codexDir, 'sessions');
    const sessionFileIndexFingerprint = getSessionFileIndexFingerprint(sessionsDir);
    const sessionIndexEntries = readSessionIndexEntries(codexDir);
    return {
        sessionFilesByThreadId: getSessionFilesByThreadId(sessionsDir, sessionFileIndexFingerprint),
        sessionIndexEntries,
        sessionIndexThreadNames: getSessionIndexThreadNamesById(codexDir, sessionIndexEntries),
    };
};

export const readFallbackThreadRowById = (
    dbPath: string,
    threadId: string,
    options: ReadFallbackThreadRowsOptions = {},
    suppliedFilesystemData?: BrowseFilesystemData,
): ThreadRow | null => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const entry = (suppliedFilesystemData?.sessionIndexEntries ?? readSessionIndexEntries(codexDir)).find(
        (candidate) => candidate.id === threadId,
    );
    if (!entry) {
        return null;
    }

    const sessionFile = suppliedFilesystemData
        ? (suppliedFilesystemData.sessionFilesByThreadId.get(threadId) ?? null)
        : findSessionFileByThreadId(path.join(codexDir, 'sessions'), threadId);
    if (!sessionFile) {
        return null;
    }

    return readFallbackThreadRow(entry, sessionFile, options);
};

export const mergeFallbackThreadRows = (dbPath: string, threads: ThreadRow[], projectName: string | null = null) => {
    const titledThreads = applySessionIndexThreadNames(dbPath, threads);
    const threadIds = new Set(titledThreads.map((thread) => thread.id));
    return [...titledThreads, ...readFallbackThreadRows(dbPath, threadIds, projectName)].sort(
        compareThreadsByRecentActivity,
    );
};

export const applyRolloutActivityTimestamps = async <T extends ActivityTimestampedThread>(
    dbPath: string,
    threads: T[],
): Promise<T[]> => {
    const activeThreads = await mapWithConcurrency(threads, THREAD_LIST_IO_CONCURRENCY, async (thread): Promise<T> => {
        const rolloutPath = resolveCodexRolloutPath(dbPath, thread.rollout_path);
        const normalizedThread =
            rolloutPath === thread.rollout_path ? thread : { ...thread, rollout_path: rolloutPath };
        let rolloutUpdatedAtMs = getThreadUpdatedAtMs(thread);
        try {
            rolloutUpdatedAtMs = Math.max(rolloutUpdatedAtMs, (await stat(rolloutPath)).mtimeMs);
        } catch {}

        if (rolloutUpdatedAtMs <= getThreadUpdatedAtMs(thread)) {
            return normalizedThread;
        }

        return {
            ...normalizedThread,
            updated_at: Math.floor(rolloutUpdatedAtMs / 1000),
            updated_at_ms: Math.floor(rolloutUpdatedAtMs),
        };
    });

    return activeThreads.sort(compareThreadsByRecentActivity);
};

export const listFallbackThreadsForPath = async (
    dbPath: string,
    existingThreadIds: Set<string>,
    cwd: string,
    options: { updatedAfterMs?: number; updatedBeforeMs?: number } = {},
): Promise<ThreadRow[]> => {
    const codexDir = resolveCodexDirFromDbPath(dbPath);
    const sessionFilesByThreadId = getSessionFilesByThreadId(path.join(codexDir, 'sessions'));
    const candidates = readSessionIndexEntries(codexDir).filter(
        (entry) => !existingThreadIds.has(entry.id) && sessionFilesByThreadId.has(entry.id),
    );

    const rows = await mapWithConcurrency(candidates, THREAD_LIST_IO_CONCURRENCY, async (entry) => {
        const sessionFile = sessionFilesByThreadId.get(entry.id);
        if (!sessionFile) {
            return null;
        }

        const sessionMeta = readFallbackSessionMeta(sessionFile);
        if (!sessionMeta?.cwd || !(await getConversationPathMatch(cwd, sessionMeta.cwd))) {
            return null;
        }

        const thread = readFallbackThreadRow(entry, sessionFile);
        if (!thread) {
            return null;
        }

        const updatedAtMs = thread.updated_at_ms ?? thread.updated_at * 1000;
        if (
            (options.updatedAfterMs !== undefined && updatedAtMs < options.updatedAfterMs) ||
            (options.updatedBeforeMs !== undefined && updatedAtMs > options.updatedBeforeMs)
        ) {
            return null;
        }
        return thread;
    });

    return rows.filter((thread): thread is ThreadRow => thread !== null).sort(compareThreadsByRecentActivity);
};
