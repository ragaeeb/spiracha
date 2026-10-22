// Portable Claude Code JSONL event parsing shared by the local storage adapter and
// `spiracha/payload`. Keep this module free of Bun, Node, and filesystem imports.
import type { ClaudeCodeTranscriptEntry, ClaudeCodeTranscriptPart } from './claude-code-exporter-types';
import {
    getClaudeCodeAssistantMessagePhase,
    isClaudeCodeRawFlagEnabled,
    isClaudeCodeSyntheticTranscriptEntry,
} from './claude-code-transcript-phase';
import { asBoolean, asNumber, asObject, asString, cleanExtractedText, type JsonValue } from './shared-text';

export type SessionStats = {
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

export type SessionStatsTracker = {
    assistantMessageIds: Set<string>;
    usageMessageIds: Set<string>;
};

export type SessionIdentity = {
    cwd: string | null;
    firstUserText: string | null;
    gitBranch: string | null;
    isSubagent: boolean;
    model: string | null;
    sessionId: string;
    title: string | null;
    version: string | null;
};

export type SessionTimeline = {
    createdAtIso: string | null;
    createdAtMs: number | null;
    lastActiveAtIso: string | null;
    lastActiveAtMs: number | null;
};

export const cleanLabel = (value: string | null | undefined): string | null => {
    const cleaned = value?.replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned : null;
};

export const toIso = (value: number | null): string | null => {
    return value === null ? null : new Date(value).toISOString();
};

export const parseTimestampMs = (value: JsonValue | undefined): number | null => {
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

export const formatJsonLike = (value: JsonValue | undefined): string | null => {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value, null, 2);
};

export const textFromContentValue = (value: JsonValue | undefined): string => {
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

export const parseTextContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => ({
    raw: item,
    text: asString(item.text ?? null) ?? '',
    type: 'text',
});

export const parseThinkingContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => ({
    raw: item,
    text: asString(item.thinking ?? null) ?? '',
    type: 'thinking',
});

export const parseToolUseContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => ({
    argumentsText: formatJsonLike(item.input),
    raw: item,
    toolName: asString(item.name ?? null) ?? 'unknown',
    toolUseId: asString(item.id ?? null),
    type: 'tool_use',
});

export const parseToolResultContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => ({
    isError: asBoolean(item.is_error ?? null),
    outputText: cleanExtractedText(textFromContentValue(item.content)).trim(),
    raw: item,
    toolUseId: asString(item.tool_use_id ?? null),
    type: 'tool_result',
});

export const parseFallbackContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => {
    const fallbackText = asString(item.text ?? null);
    return {
        raw: item,
        text: fallbackText ?? undefined,
        type: fallbackText ? 'text' : 'unknown',
    };
};

export const structuredContentParsers: Record<string, (item: Record<string, JsonValue>) => ClaudeCodeTranscriptPart> = {
    input_text: parseTextContentPart,
    output_text: parseTextContentPart,
    text: parseTextContentPart,
    thinking: parseThinkingContentPart,
    tool_result: parseToolResultContentPart,
    tool_use: parseToolUseContentPart,
};

export const parseStructuredContentPart = (item: Record<string, JsonValue>): ClaudeCodeTranscriptPart => {
    const type = asString(item.type ?? null);
    return type
        ? (structuredContentParsers[type]?.(item) ?? parseFallbackContentPart(item))
        : parseFallbackContentPart(item);
};

export const parseMessageContentPart = (item: JsonValue): ClaudeCodeTranscriptPart | null => {
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

export const parseMessageParts = (message: Record<string, JsonValue>): ClaudeCodeTranscriptPart[] => {
    const content = message.content;
    const items = Array.isArray(content) ? content : [content];
    return items
        .map(parseMessageContentPart)
        .filter((part): part is ClaudeCodeTranscriptPart => part !== null && part.type !== 'unknown');
};

export const parseAttachmentParts = (raw: Record<string, JsonValue>): ClaudeCodeTranscriptPart[] => {
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

export const getTranscriptEntryParts = (
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

export const getTranscriptEntryRole = (type: string, message: Record<string, JsonValue> | null): string => {
    return asString(message?.role ?? null) ?? (type === 'attachment' ? 'attachment' : type);
};

export const getTranscriptEntryId = (type: string, raw: Record<string, JsonValue>): string => {
    return asString(raw.uuid ?? null) ?? `${type}:${asString(raw.sessionId ?? null) ?? 'unknown'}`;
};

// A prompt sent while the agent is mid-turn is stored only as a queued_command attachment.
export const getQueuedUserPromptMessage = (raw: Record<string, JsonValue>): Record<string, JsonValue> | null => {
    const attachment = raw.type === 'attachment' ? asObject(raw.attachment ?? null) : null;
    const prompt = asString(attachment?.prompt ?? null);
    const isHumanPrompt =
        attachment?.type === 'queued_command' &&
        attachment.commandMode === 'prompt' &&
        asObject(attachment.origin ?? null)?.kind === 'human';
    return isHumanPrompt && prompt?.trim() ? { content: prompt, role: 'user' } : null;
};

export const parseTranscriptEntry = (raw: Record<string, JsonValue>): ClaudeCodeTranscriptEntry | null => {
    const queuedUserPrompt = getQueuedUserPromptMessage(raw);
    const type = queuedUserPrompt ? 'user' : (asString(raw.type ?? null) ?? 'unknown');
    const message = queuedUserPrompt ?? asObject(raw.message ?? null);
    const parts = getTranscriptEntryParts(type, message, raw);
    const role = getTranscriptEntryRole(type, message);

    if (parts.length === 0) {
        return null;
    }

    return {
        assistantPhase: getClaudeCodeAssistantMessagePhase({ parts, raw, role }),
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

export const createEmptyStats = (): SessionStats => ({
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

export const createStatsTracker = (): SessionStatsTracker => ({
    assistantMessageIds: new Set(),
    usageMessageIds: new Set(),
});

export const getMessageIdentity = (entry: ClaudeCodeTranscriptEntry): string => {
    const message = asObject(entry.raw.message ?? null);
    return asString(message?.id ?? null) ?? entry.entryId;
};

export const addUsageStats = (stats: SessionStats, tracker: SessionStatsTracker, entry: ClaudeCodeTranscriptEntry) => {
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

export const hasTextPart = (entry: ClaudeCodeTranscriptEntry): boolean => {
    return entry.parts.some((part) => part.type === 'text' && part.text?.trim());
};

export const extractUserPromptText = (text: string): string | null => {
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

export const updateMessageStats = (
    stats: SessionStats,
    tracker: SessionStatsTracker,
    entry: ClaudeCodeTranscriptEntry,
) => {
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

export const updateStatsFromEntry = (
    stats: SessionStats,
    tracker: SessionStatsTracker,
    entry: ClaudeCodeTranscriptEntry,
) => {
    updateMessageStats(stats, tracker, entry);

    if (entry.type === 'attachment') {
        stats.attachmentCount += 1;
    }

    stats.toolCallCount += entry.parts.filter((part) => part.type === 'tool_use').length;
    stats.toolResultCount += entry.parts.filter((part) => part.type === 'tool_result').length;
    stats.renderablePartCount += entry.parts.filter(isRenderablePart).length;
    addUsageStats(stats, tracker, entry);
};

export const updateTimeline = (
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

export const readTitleCandidate = (raw: Record<string, JsonValue>): string | null => {
    const type = asString(raw.type ?? null);
    if (type !== 'ai-title' && type !== 'custom-title') {
        return null;
    }

    return cleanLabel(
        asString(raw.customTitle ?? null) ?? asString(raw.title ?? null) ?? asString(raw.content ?? null),
    );
};

export const updateIdentityFromRaw = (identity: SessionIdentity, raw: Record<string, JsonValue>) => {
    if (!identity.isSubagent) {
        identity.sessionId = asString(raw.sessionId ?? null) ?? identity.sessionId;
    }
    identity.cwd = identity.cwd ?? asString(raw.cwd ?? null);
    identity.version = asString(raw.version ?? null) ?? identity.version;
    identity.gitBranch = asString(raw.gitBranch ?? null) ?? identity.gitBranch;

    const message = asObject(raw.message ?? null);
    identity.model = asString(message?.model ?? null) ?? identity.model;
    identity.title = readTitleCandidate(raw) ?? identity.title;
};

export const updateIdentityFromEntry = (identity: SessionIdentity, entry: ClaudeCodeTranscriptEntry) => {
    if (entry.role === 'user' && !identity.firstUserText && !isClaudeCodeSyntheticTranscriptEntry(entry)) {
        const textPart = entry.parts.find((part) => part.type === 'text' && part.text?.trim());
        identity.firstUserText = extractUserPromptText(textPart?.text ?? '');
    }
};

export const toTimeline = (
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

export const isRenderablePart = (part: ClaudeCodeTranscriptPart): boolean => {
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

export const stripEntryRawPayloads = (entry: ClaudeCodeTranscriptEntry): ClaudeCodeTranscriptEntry => {
    return {
        ...entry,
        parts: entry.parts.map((part) => ({ ...part, raw: {} })),
        raw: {},
    };
};

export const markIncompleteAssistantParentAsCommentary = (
    entries: ClaudeCodeTranscriptEntry[],
    entry: ClaudeCodeTranscriptEntry,
): void => {
    const interruptedByUser =
        entry.role === 'user' &&
        entry.parts.some(
            (part) => part.type === 'text' && part.text?.trim().startsWith('[Request interrupted by user]'),
        );
    if ((!interruptedByUser && !isClaudeCodeRawFlagEnabled(entry.raw.isApiErrorMessage)) || !entry.parentEntryId) {
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

export const markLatestAssistantAsCommentary = (entries: ClaudeCodeTranscriptEntry[]): void => {
    const latestEntry = entries.at(-1);
    if (latestEntry?.role === 'assistant') {
        latestEntry.assistantPhase = 'commentary';
    }
};

export const isTaskNotification = (raw: Record<string, JsonValue>): boolean => {
    const content =
        raw.type === 'queue-operation'
            ? asString(raw.content ?? null)
            : raw.type === 'user'
              ? textFromContentValue(asObject(raw.message ?? null)?.content)
              : null;
    return content?.trimStart().startsWith('<task-notification>') === true;
};

export type ClaudeCodeEventCollection = {
    entries: ClaudeCodeTranscriptEntry[];
    stats: SessionStats;
    timeline: { firstMs: number | null; lastMs: number | null };
};

/** Folds raw Claude Code JSONL events into renderable entries, updating `identity` in place. */
export const collectClaudeCodeEvents = (
    rawEvents: Record<string, JsonValue>[],
    identity: SessionIdentity,
    includeRawPayloads: boolean,
): ClaudeCodeEventCollection => {
    const stats = createEmptyStats();
    const statsTracker = createStatsTracker();
    const timeline = { firstMs: null as number | null, lastMs: null as number | null };
    const entries: ClaudeCodeTranscriptEntry[] = [];

    for (const raw of rawEvents) {
        updateTimeline(timeline, raw);
        updateIdentityFromRaw(identity, raw);

        if (isTaskNotification(raw)) {
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

    return { entries, stats, timeline };
};
