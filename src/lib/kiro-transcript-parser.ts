import {
    createTextMessage,
    finalizeMessages,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
    toDateMs,
} from './conversation-data/adapter-helpers';
import type { ConversationMessage } from './conversation-data/types';
import type { KiroTranscriptEntry, KiroTranscriptPart } from './kiro-exporter-types';
import {
    getFinalKiroAssistantMessageEntryIds,
    getKiroMessagePhase,
    isKiroAssistantPlaceholderEntry,
} from './kiro-transcript-phase';
import { getPortablePathBasename } from './portable-path';
import { asNumber, asObject, asString, cleanExtractedText, type JsonValue } from './shared-text';

export const toIso = (value: number | null): string | null => {
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

export const parseTimestampMs = (value: JsonValue | undefined): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    }

    if (typeof value === 'string') {
        return value.trim() ? parseTimestampStringMs(value) : null;
    }

    return null;
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

export const parseKiroHistoryEntry = (raw: Record<string, JsonValue>, index: number): KiroTranscriptEntry | null => {
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

const getActionTimestamp = (action: Record<string, JsonValue>, execution: Record<string, JsonValue>): string | null => {
    return toIso(
        parseTimestampMs(action.emittedAt) ??
            parseTimestampMs(action.endTime) ??
            parseTimestampMs(execution.endTime) ??
            parseTimestampMs(execution.startTime),
    );
};

type KiroExecutionFile = {
    filePath: string;
    raw: Record<string, JsonValue>;
};

type KiroToolCallSummary = {
    command: string;
    toolName: string;
    workdir: string | null;
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
        entryId: `${executionId ?? getPortablePathBasename(execution.filePath)}:${actionId}`,
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
    const toolCallId = `${executionId ?? getPortablePathBasename(execution.filePath)}:${actionId}`;

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
    const toolCallId = `${executionId ?? getPortablePathBasename(execution.filePath)}:${actionId}`;

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

export const parseKiroExecutionEntries = (
    raw: Record<string, JsonValue>,
    filePath = 'payload',
): KiroTranscriptEntry[] => {
    const execution: KiroExecutionFile = { filePath, raw };
    const actions = Array.isArray(execution.raw.actions) ? execution.raw.actions : [];
    return actions.flatMap((item, index) => {
        const action = asObject(item);
        return action ? parseExecutionActionEntries(execution, action, index) : [];
    });
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

export const mergeKiroTranscriptEntries = (
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

const getPartString = (part: KiroTranscriptPart, key: string): string | null => {
    const value = part.raw[key];
    return typeof value === 'string' && value.trim() ? value : null;
};

const getPartNumber = (part: KiroTranscriptPart, key: string): number | null => {
    const value = part.raw[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const normalizeKiroTranscriptPart = (
    entry: KiroTranscriptEntry,
    part: KiroTranscriptPart,
    partIndex: number,
    finalEntryIds: Set<string>,
): ConversationMessage[] => {
    const createdAtMs = toDateMs(entry.timestamp);
    if (entry.entryType === 'tool_call') {
        const toolName = getPartString(part, 'toolName') ?? 'unknown';
        const callId = getPartString(part, 'toolCallId') ?? entry.entryId;
        return createTextMessage({
            createdAtMs,
            id: `${entry.entryId}:${partIndex}`,
            metadata: {
                executionId: entry.executionId,
                toolCallId: callId,
                toolName,
            },
            order: partIndex,
            phase: 'tool_call',
            role: 'tool',
            text: part.text,
            toolEvidence: {
                callId,
                command: getPartString(part, 'command'),
                durationMs: null,
                exitCode: null,
                inputText: part.text ?? null,
                name: toolName,
                namespace: toolName.includes('.') ? (toolName.split('.')[0] ?? null) : null,
                outputText: null,
                status: 'unknown',
                workdir: getPartString(part, 'workdir'),
            },
        });
    }

    if (entry.entryType === 'tool_output') {
        const toolName = getPartString(part, 'toolName') ?? 'unknown';
        const callId = getPartString(part, 'toolCallId');
        const exitCode = getPartNumber(part, 'exitCode');
        return createTextMessage({
            createdAtMs,
            id: `${entry.entryId}:${partIndex}`,
            metadata: {
                executionId: entry.executionId,
                toolCallId: callId,
                toolName,
            },
            order: partIndex,
            phase: 'tool_output',
            role: 'tool',
            text: part.text,
            toolEvidence: {
                callId,
                command: null,
                durationMs: null,
                exitCode,
                inputText: null,
                name: toolName,
                namespace: toolName.includes('.') ? (toolName.split('.')[0] ?? null) : null,
                outputText: part.text ?? null,
                status: normalizeToolStatus(null, exitCode),
                workdir: null,
            },
        });
    }

    return createTextMessage({
        createdAtMs,
        id: `${entry.entryId}:${partIndex}`,
        metadata: part.imageUrl ? { imageUrl: part.imageUrl } : {},
        order: partIndex,
        phase: normalizeAssistantPhase(getKiroMessagePhase(entry, finalEntryIds), 'unknown'),
        role: normalizeRole(entry.role),
        text: part.text ?? part.imageUrl,
    });
};

export const normalizeKiroTranscriptEntries = (entries: KiroTranscriptEntry[]): ConversationMessage[] => {
    const finalEntryIds = getFinalKiroAssistantMessageEntryIds(entries);
    return finalizeMessages(
        entries.flatMap((entry) =>
            entry.parts.flatMap((part, partIndex) =>
                normalizeKiroTranscriptPart(entry, part, partIndex, finalEntryIds),
            ),
        ),
    );
};
