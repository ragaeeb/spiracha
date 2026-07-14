import { readdir, stat, unlink } from 'node:fs/promises';
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
import {
    getClaudeCodeAssistantMessagePhase,
    isClaudeCodeSyntheticTranscriptEntry,
} from './claude-code-transcript-phase';
import { mapWithConcurrency } from './concurrency';
import {
    asBoolean,
    asNumber,
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

type ReadTranscriptFileOptions = {
    includeRawPayloads?: boolean;
};

export type ReadClaudeCodeSessionTranscriptOptions = ReadTranscriptFileOptions;

export type DeleteClaudeCodeSessionResult = {
    deletedFiles: string[];
    deletedSessionIds: string[];
};

type SessionStats = {
    assistantMessageCount: number;
    attachmentCount: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    inputTokens: number;
    messageCount: number;
    outputTokens: number;
    renderablePartCount: number;
    toolCallCount: number;
    toolResultCount: number;
    userMessageCount: number;
};

type SessionStatsTracker = {
    assistantMessageIds: Set<string>;
    usageMessageIds: Set<string>;
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

const unlinkIfPresent = async (target: string): Promise<boolean> => {
    try {
        await unlink(target);
        return true;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
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
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric;
    }

    const parsed = Date.parse(value);
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
    const role = getTranscriptEntryRole(type, message);

    if (parts.length === 0) {
        return null;
    }

    return {
        assistantPhase: getClaudeCodeAssistantMessagePhase({ raw, role }),
        cwd: asString(raw.cwd ?? null),
        entryId: getTranscriptEntryId(type, raw),
        model: asString(message?.model ?? null),
        parentEntryId: asString(raw.parentUuid ?? null),
        parts,
        raw,
        role,
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
    renderablePartCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    userMessageCount: 0,
});

const createStatsTracker = (): SessionStatsTracker => ({
    assistantMessageIds: new Set(),
    usageMessageIds: new Set(),
});

const getMessageIdentity = (entry: ClaudeCodeTranscriptEntry): string => {
    const message = asObject(entry.raw.message ?? null);
    return asString(message?.id ?? null) ?? entry.entryId;
};

const addUsageStats = (stats: SessionStats, tracker: SessionStatsTracker, entry: ClaudeCodeTranscriptEntry) => {
    const message = asObject(entry.raw.message ?? null);
    const usage = asObject(message?.usage ?? null);
    if (!usage) {
        return;
    }

    const messageId = getMessageIdentity(entry);
    if (tracker.usageMessageIds.has(messageId)) {
        return;
    }
    tracker.usageMessageIds.add(messageId);

    stats.inputTokens += asNumber(usage.input_tokens ?? null) ?? 0;
    stats.outputTokens += asNumber(usage.output_tokens ?? null) ?? 0;
    stats.cacheCreationInputTokens += asNumber(usage.cache_creation_input_tokens ?? null) ?? 0;
    stats.cacheReadInputTokens += asNumber(usage.cache_read_input_tokens ?? null) ?? 0;
};

const hasTextPart = (entry: ClaudeCodeTranscriptEntry): boolean => {
    return entry.parts.some((part) => part.type === 'text' && part.text?.trim());
};

const extractUserPromptText = (text: string): string | null => {
    const cleaned = cleanExtractedText(text).trim();
    if (!cleaned.startsWith('<!-- attach -->')) {
        return cleaned || null;
    }

    const lines = cleaned.split('\n').slice(1);
    let sawQuotedAttachment = false;
    for (const [index, line] of lines.entries()) {
        const trimmed = line.trim();
        if (trimmed.startsWith('>')) {
            sawQuotedAttachment = true;
            continue;
        }
        if (!trimmed) {
            continue;
        }
        if (sawQuotedAttachment) {
            return lines.slice(index).join('\n').trim() || null;
        }
    }

    return null;
};

const updateMessageStats = (stats: SessionStats, tracker: SessionStatsTracker, entry: ClaudeCodeTranscriptEntry) => {
    if (entry.role === 'user' && hasTextPart(entry) && !isClaudeCodeSyntheticTranscriptEntry(entry)) {
        stats.messageCount += 1;
        stats.userMessageCount += 1;
        return;
    }

    if (entry.role !== 'assistant' || !hasTextPart(entry)) {
        return;
    }

    const messageId = getMessageIdentity(entry);
    if (tracker.assistantMessageIds.has(messageId)) {
        return;
    }
    tracker.assistantMessageIds.add(messageId);
    stats.messageCount += 1;
    stats.assistantMessageCount += 1;
};

const updateStatsFromEntry = (stats: SessionStats, tracker: SessionStatsTracker, entry: ClaudeCodeTranscriptEntry) => {
    updateMessageStats(stats, tracker, entry);

    if (entry.type === 'attachment') {
        stats.attachmentCount += 1;
    }

    stats.toolCallCount += entry.parts.filter((part) => part.type === 'tool_use').length;
    stats.toolResultCount += entry.parts.filter((part) => part.type === 'tool_result').length;
    stats.renderablePartCount += entry.parts.filter(isRenderablePart).length;
    addUsageStats(stats, tracker, entry);
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
    if (entry.role === 'user' && !identity.firstUserText && !isClaudeCodeSyntheticTranscriptEntry(entry)) {
        const textPart = entry.parts.find((part) => part.type === 'text' && part.text?.trim());
        identity.firstUserText = extractUserPromptText(textPart?.text ?? '');
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

const stripEntryRawPayloads = (entry: ClaudeCodeTranscriptEntry): ClaudeCodeTranscriptEntry => {
    return {
        ...entry,
        parts: entry.parts.map((part) => ({ ...part, raw: {} })),
        raw: {},
    };
};

const markIncompleteAssistantParentAsCommentary = (
    entries: ClaudeCodeTranscriptEntry[],
    entry: ClaudeCodeTranscriptEntry,
): void => {
    const interruptedByUser =
        entry.role === 'user' &&
        entry.parts.some(
            (part) => part.type === 'text' && part.text?.trim().startsWith('[Request interrupted by user]'),
        );
    if ((!interruptedByUser && entry.raw.isApiErrorMessage !== true) || !entry.parentEntryId) {
        return;
    }

    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const candidate = entries[index];
        if (candidate?.entryId === entry.parentEntryId && candidate.role === 'assistant') {
            candidate.assistantPhase = 'commentary';
            return;
        }
    }
};

const markLatestAssistantAsCommentary = (entries: ClaudeCodeTranscriptEntry[]): void => {
    const latestEntry = entries.at(-1);
    if (latestEntry?.role === 'assistant') {
        latestEntry.assistantPhase = 'commentary';
    }
};

const isSubagentTaskNotification = (raw: Record<string, JsonValue>): boolean => {
    return (
        raw.type === 'queue-operation' &&
        asString(raw.content ?? null)
            ?.trimStart()
            .startsWith('<task-notification>') === true
    );
};

const buildTranscriptFromRawEvents = (
    file: TranscriptFile,
    sourceRawEvents: Record<string, JsonValue>[],
    fallbackMtimeMs: number | null,
    includeRawPayloads: boolean,
): ClaudeCodeSessionTranscript => {
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
    const statsTracker = createStatsTracker();
    const timeline = { firstMs: null as number | null, lastMs: null as number | null };
    const entries: ClaudeCodeTranscriptEntry[] = [];

    for (const raw of sourceRawEvents) {
        updateTimeline(timeline, raw);
        updateIdentityFromRaw(identity, raw);

        if (isSubagentTaskNotification(raw)) {
            markLatestAssistantAsCommentary(entries);
        }

        const entry = parseTranscriptEntry(raw);
        if (!entry) {
            continue;
        }

        markIncompleteAssistantParentAsCommentary(entries, entry);
        if (isClaudeCodeSyntheticTranscriptEntry(entry)) {
            continue;
        }

        entries.push(includeRawPayloads ? entry : stripEntryRawPayloads(entry));
        updateStatsFromEntry(stats, statsTracker, entry);
        updateIdentityFromEntry(identity, entry);
    }

    const session = toSessionSummary(file, identity, stats, toTimeline(timeline, fallbackMtimeMs));
    return {
        entries,
        rawEvents: includeRawPayloads ? sourceRawEvents : [],
        rawPayloadsOmitted: includeRawPayloads ? undefined : true,
        renderablePartCount: stats.renderablePartCount,
        session,
    };
};

const readTranscriptFile = async (
    file: TranscriptFile,
    options: ReadTranscriptFileOptions = {},
): Promise<ParsedTranscriptFile | null> => {
    const includeRawPayloads = options.includeRawPayloads ?? true;
    const fallbackMtimeMs = await stat(file.filePath)
        .then((stats) => stats.mtimeMs)
        .catch(() => null);
    const rawEvents: Record<string, JsonValue>[] = [];

    try {
        for await (const raw of readJsonlObjects(file.filePath)) {
            rawEvents.push(raw);
        }
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }

    return {
        transcript: buildTranscriptFromRawEvents(file, rawEvents, fallbackMtimeMs, includeRawPayloads),
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
    const parsed = await mapWithConcurrency(files, READ_CONCURRENCY, (file) => readTranscriptFile(file));
    return parsed.flatMap((item) => (item ? [item.transcript] : []));
};

const getCompactionSummaryId = (raw: Record<string, JsonValue>): string | null => {
    return raw.isCompactSummary === true ? asString(raw.uuid ?? null) : null;
};

const getCompactionSummaryIds = (transcript: ClaudeCodeSessionTranscript): string[] => {
    return [...new Set(transcript.rawEvents.map(getCompactionSummaryId).filter((id): id is string => id !== null))];
};

type TranscriptLineageIndex = {
    anchorsByIndex: string[][];
    indexesByAnchor: Map<string, number[]>;
};

const indexTranscriptLineageAnchors = (transcripts: ClaudeCodeSessionTranscript[]): TranscriptLineageIndex => {
    const indexesByAnchor = new Map<string, number[]>();
    const anchorsByIndex = transcripts.map((transcript, index) => {
        const anchors = getCompactionSummaryIds(transcript).map(
            (anchorId) => `${transcript.session.workspaceKey}\0${anchorId}`,
        );
        for (const anchor of anchors) {
            const indexes = indexesByAnchor.get(anchor) ?? [];
            indexes.push(index);
            indexesByAnchor.set(anchor, indexes);
        }
        return anchors;
    });

    return { anchorsByIndex, indexesByAnchor };
};

const collectTranscriptLineage = (
    startIndex: number,
    transcripts: ClaudeCodeSessionTranscript[],
    index: TranscriptLineageIndex,
    visited: Set<number>,
): ClaudeCodeSessionTranscript[] => {
    const lineage: ClaudeCodeSessionTranscript[] = [];
    const pending = [startIndex];
    visited.add(startIndex);

    while (pending.length > 0) {
        const currentIndex = pending.pop() as number;
        const transcript = transcripts[currentIndex];
        if (!transcript) {
            continue;
        }
        lineage.push(transcript);

        const neighborIndexes = (index.anchorsByIndex[currentIndex] ?? []).flatMap(
            (anchor) => index.indexesByAnchor.get(anchor) ?? [],
        );
        for (const neighborIndex of neighborIndexes) {
            if (!visited.has(neighborIndex)) {
                visited.add(neighborIndex);
                pending.push(neighborIndex);
            }
        }
    }

    return lineage;
};

const getTranscriptLineages = (transcripts: ClaudeCodeSessionTranscript[]): ClaudeCodeSessionTranscript[][] => {
    const index = indexTranscriptLineageAnchors(transcripts);
    const visited = new Set<number>();
    const lineages: ClaudeCodeSessionTranscript[][] = [];

    for (const startIndex of transcripts.keys()) {
        if (visited.has(startIndex)) {
            continue;
        }
        lineages.push(collectTranscriptLineage(startIndex, transcripts, index, visited));
    }

    return lineages;
};

const countContentEntriesBefore = (transcript: ClaudeCodeSessionTranscript, rawEventIndex: number): number => {
    let count = 0;
    for (const raw of transcript.rawEvents.slice(0, rawEventIndex)) {
        const entry = parseTranscriptEntry(raw);
        if (entry && !isClaudeCodeSyntheticTranscriptEntry(entry)) {
            count += 1;
        }
    }
    return count;
};

const deduplicateRawEvents = (rawEvents: Record<string, JsonValue>[]): Record<string, JsonValue>[] => {
    const seenIds = new Set<string>();
    return rawEvents.filter((raw) => {
        const eventId = asString(raw.uuid ?? null);
        if (!eventId) {
            return true;
        }
        if (seenIds.has(eventId)) {
            return false;
        }
        seenIds.add(eventId);
        return true;
    });
};

const buildLogicalRawEvents = (
    lineage: ClaudeCodeSessionTranscript[],
    current: ClaudeCodeSessionTranscript,
    visiting = new Set<string>(),
): Record<string, JsonValue>[] => {
    if (visiting.has(current.session.sessionId)) {
        return deduplicateRawEvents(current.rawEvents);
    }

    const firstAnchorIndex = current.rawEvents.findIndex((raw) => getCompactionSummaryId(raw) !== null);
    const firstAnchor = firstAnchorIndex < 0 ? null : getCompactionSummaryId(current.rawEvents[firstAnchorIndex] ?? {});
    if (!firstAnchor) {
        return deduplicateRawEvents(current.rawEvents);
    }

    const currentPrefixSize = countContentEntriesBefore(current, firstAnchorIndex);
    const ancestor = lineage
        .filter((candidate) => candidate.session.sessionId !== current.session.sessionId)
        .map((candidate) => {
            const anchorIndex = candidate.rawEvents.findIndex((raw) => getCompactionSummaryId(raw) === firstAnchor);
            return {
                anchorIndex,
                candidate,
                prefixSize: anchorIndex < 0 ? -1 : countContentEntriesBefore(candidate, anchorIndex),
            };
        })
        .filter((candidate) => candidate.prefixSize > currentPrefixSize)
        .sort(
            (left, right) =>
                right.prefixSize - left.prefixSize ||
                (left.candidate.session.createdAtMs ?? 0) - (right.candidate.session.createdAtMs ?? 0),
        )[0];
    if (!ancestor) {
        return deduplicateRawEvents(current.rawEvents);
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(current.session.sessionId);
    const ancestorEvents = buildLogicalRawEvents(lineage, ancestor.candidate, nextVisiting);
    const ancestorAnchorIndex = ancestorEvents.findIndex((raw) => getCompactionSummaryId(raw) === firstAnchor);
    if (ancestorAnchorIndex < 0) {
        return deduplicateRawEvents(current.rawEvents);
    }

    return deduplicateRawEvents([
        ...ancestorEvents.slice(0, ancestorAnchorIndex),
        ...current.rawEvents.slice(firstAnchorIndex),
    ]);
};

const compareTranscriptsByActivity = (
    left: ClaudeCodeSessionTranscript,
    right: ClaudeCodeSessionTranscript,
): number => {
    return (
        compareNullableMsDesc(left.session.lastActiveAtMs, right.session.lastActiveAtMs) ||
        left.session.sessionId.localeCompare(right.session.sessionId)
    );
};

const coalesceTranscriptLineage = (lineage: ClaudeCodeSessionTranscript[]): ClaudeCodeSessionTranscript | null => {
    const canonical = [...lineage].sort(compareTranscriptsByActivity)[0];
    if (!canonical) {
        return null;
    }

    const directoryName = getDirectoryNameFromWorkspaceKey(canonical.session.workspaceKey);
    if (!directoryName) {
        return canonical;
    }

    const transcript = buildTranscriptFromRawEvents(
        { directoryName, filePath: canonical.session.filePath },
        buildLogicalRawEvents(lineage, canonical),
        canonical.session.lastActiveAtMs,
        true,
    );
    transcript.session.filePath = canonical.session.filePath;
    transcript.session.sessionId = canonical.session.sessionId;
    return transcript;
};

const coalesceTranscriptLineages = (transcripts: ClaudeCodeSessionTranscript[]): ClaudeCodeSessionTranscript[] => {
    return getTranscriptLineages(transcripts).flatMap((lineage) => {
        const transcript = coalesceTranscriptLineage(lineage);
        return transcript ? [transcript] : [];
    });
};

const omitTranscriptRawPayloads = (transcript: ClaudeCodeSessionTranscript): ClaudeCodeSessionTranscript => ({
    ...transcript,
    entries: transcript.entries.map(stripEntryRawPayloads),
    rawEvents: [],
    rawPayloadsOmitted: true,
});

const hasSessionContent = (transcript: ClaudeCodeSessionTranscript): boolean => {
    return transcript.session.userMessageCount > 0 || transcript.session.assistantMessageCount > 0;
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
    const transcripts = coalesceTranscriptLineages(await readTranscriptFiles(files));
    const sessionsByDirectory = new Map<string, ClaudeCodeSessionSummary[]>();

    for (const transcript of transcripts) {
        const directoryName = getDirectoryNameFromWorkspaceKey(transcript.session.workspaceKey);
        if (!directoryName) {
            continue;
        }

        if (!hasSessionContent(transcript)) {
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

    if (isWorkspacePathQuery(raw)) {
        return workspacePathMatchesQuery(workspace.worktree, raw);
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
    return [...sessions].sort(
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
    const transcripts = coalesceTranscriptLineages(await readTranscriptFiles(files));
    return sortSessions(transcripts.filter(hasSessionContent).map((transcript) => transcript.session));
};

const locateSessionFile = async (projectsDir: string, sessionId: string): Promise<TranscriptFile | null> => {
    const files = await listTranscriptFiles(projectsDir);
    return files.find((file) => path.basename(file.filePath, '.jsonl') === sessionId) ?? null;
};

export const readClaudeCodeSessionTranscript = async (
    projectsDir: string,
    sessionId: string,
    options: ReadClaudeCodeSessionTranscriptOptions = {},
): Promise<ClaudeCodeSessionTranscript | null> => {
    if (!(await pathExists(projectsDir))) {
        return null;
    }

    const file = await locateSessionFile(projectsDir, sessionId);
    if (!file) {
        return null;
    }

    const files = await listTranscriptFilesForProject(projectsDir, file.directoryName);
    const transcripts = await readTranscriptFiles(files);
    const lineage = getTranscriptLineages(transcripts).find((candidate) =>
        candidate.some((transcript) => transcript.session.sessionId === sessionId),
    );
    if (!lineage) {
        return null;
    }

    const transcript = coalesceTranscriptLineage(lineage);
    if (!transcript) {
        return null;
    }
    return options.includeRawPayloads === false ? omitTranscriptRawPayloads(transcript) : transcript;
};

export const deleteClaudeCodeSession = async (
    projectsDir: string,
    sessionId: string,
): Promise<DeleteClaudeCodeSessionResult> => {
    if (!(await pathExists(projectsDir))) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const file = await locateSessionFile(projectsDir, sessionId);
    if (!file) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const files = await listTranscriptFilesForProject(projectsDir, file.directoryName);
    const transcripts = await readTranscriptFiles(files);
    const lineage = getTranscriptLineages(transcripts).find((candidate) =>
        candidate.some((transcript) => transcript.session.sessionId === sessionId),
    );
    const targets = (lineage ?? [])
        .map((transcript) => ({
            filePath: transcript.session.filePath,
            sessionId: transcript.session.sessionId,
        }))
        .sort((left, right) => left.filePath.localeCompare(right.filePath));
    if (targets.length === 0) {
        return { deletedFiles: [], deletedSessionIds: [] };
    }

    const removed = await Promise.all(targets.map((target) => unlinkIfPresent(target.filePath)));
    return {
        deletedFiles: targets.flatMap((target, index) => (removed[index] ? [target.filePath] : [])),
        deletedSessionIds: targets.flatMap((target, index) => (removed[index] ? [target.sessionId] : [])),
    };
};
