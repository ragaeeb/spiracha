import {
    createTextMessage,
    finalizeMessages,
    normalizeAssistantPhase,
    normalizeRole,
    normalizeToolStatus,
    toDateMs,
} from './conversation-data/adapter-helpers';
import type { ConversationMessage } from './conversation-data/types';
import type { QoderAcpSessionUpdate } from './qoder-acp-client';
import type { QoderTranscriptEntry, QoderTranscriptPart } from './qoder-exporter-types';
import { getFinalQoderAssistantMessageEntryIds, getQoderMessagePhase } from './qoder-transcript-phase';
import { asObject, asString, type JsonValue } from './shared-text';

const QODER_MODEL_LABELS: Record<string, string> = {
    dfmodel: 'DeepSeek V4 Flash',
    dmodel: 'DeepSeek V4 Pro',
    gm51model: 'GLM 5.2',
    gmodel: 'GLM 5',
    kmodel: 'Kimi K2.7 Code',
    mmodel: 'MiniMax M3',
    q35model: 'Qwen 3.5 Plus',
    q35model_preview: 'Qwen 3.7 Max DogFooding',
    qmodel: 'Qwen 3.7 Plus',
    qmodel_latest: 'Qwen 3.7 Max',
};

export const normalizeQoderModelLabel = (value: string | null): string | null => {
    return value ? (QODER_MODEL_LABELS[value] ?? value) : null;
};

export const parseTimestampMs = (value: JsonValue | undefined): number | null => {
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

export const toIso = (value: number | null): string | null => {
    return value === null ? null : new Date(value).toISOString();
};

export const parseJsonValue = (value: string): JsonValue | null => {
    try {
        return JSON.parse(value) as JsonValue;
    } catch {
        return null;
    }
};

export const parseTextPart = (raw: Record<string, JsonValue>, text: string): QoderTranscriptPart => ({
    raw,
    text,
    type: 'text',
});

type QoderCliPart = {
    entryType: QoderTranscriptEntry['entryType'];
    raw: Record<string, JsonValue>;
    role: string;
    text: string;
};

const stringifyCliValue = (value: JsonValue | undefined): string | null => {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (value === null || value === undefined) {
        return null;
    }

    return JSON.stringify(value, null, 2);
};

const getCliTextValue = (value: JsonValue | undefined): string | null => {
    if (Array.isArray(value)) {
        const text = value
            .map((item) => getCliTextValue(item))
            .filter((item): item is string => Boolean(item?.trim()))
            .join('\n');
        return text ? text : null;
    }

    const objectValue = asObject(value ?? null);
    if (objectValue) {
        return (
            getCliTextValue(objectValue.text) ??
            getCliTextValue(objectValue.content) ??
            getCliTextValue(objectValue.result) ??
            stringifyCliValue(objectValue)
        );
    }

    return stringifyCliValue(value);
};

const getCliPartData = (part: Record<string, JsonValue>): Record<string, JsonValue> => {
    return asObject(part.data ?? null) ?? part;
};

const getCliToolName = (part: Record<string, JsonValue>, data: Record<string, JsonValue>): string => {
    return asString(data.name ?? null) ?? asString(part.name ?? null) ?? 'qoder_tool';
};

const formatCliToolCall = (part: Record<string, JsonValue>, data: Record<string, JsonValue>): string | null => {
    const name = getCliToolName(part, data);
    const input = getCliTextValue(data.input ?? part.input);
    const text = [name, input].filter((value): value is string => Boolean(value?.trim())).join('\n');
    return text || null;
};

const cliTextPartToTranscriptPart = (part: Record<string, JsonValue>, role: string): QoderCliPart | null => {
    const data = getCliPartData(part);
    const text = getCliTextValue(data.text ?? part.text);
    return text ? { entryType: 'message', raw: part, role, text } : null;
};

const cliReasoningPartToTranscriptPart = (part: Record<string, JsonValue>, type: string): QoderCliPart | null => {
    const data = getCliPartData(part);
    const text = getCliTextValue(data.thinking ?? data.signature ?? part.thinking ?? part.text);
    return text ? { entryType: 'message', raw: { ...part, sourceType: type }, role: 'assistant', text } : null;
};

const cliToolCallPartToTranscriptPart = (part: Record<string, JsonValue>): QoderCliPart | null => {
    const data = getCliPartData(part);
    const text = formatCliToolCall(part, data);
    return text
        ? {
              entryType: 'tool_call',
              raw: {
                  ...part,
                  command: text,
                  toolCallId: asString(data.id ?? data.tool_use_id ?? part.id ?? part.tool_use_id ?? null),
                  toolName: getCliToolName(part, data),
              },
              role: 'tool',
              text,
          }
        : null;
};

const cliToolOutputPartToTranscriptPart = (part: Record<string, JsonValue>): QoderCliPart | null => {
    const data = getCliPartData(part);
    const text = getCliTextValue(data.content ?? data.output ?? part.content);
    return text
        ? {
              entryType: 'tool_output',
              raw: {
                  ...part,
                  toolCallId: asString(data.tool_use_id ?? part.tool_use_id ?? null),
                  toolName: getCliToolName(part, data),
              },
              role: 'tool',
              text,
          }
        : null;
};

const cliPartToTranscriptPart = (part: Record<string, JsonValue>, role: string): QoderCliPart | null => {
    const type = asString(part.type ?? null);
    switch (type) {
        case 'text':
            return cliTextPartToTranscriptPart(part, role);
        case 'reasoning':
        case 'thinking':
            return cliReasoningPartToTranscriptPart(part, type);
        case 'tool_call':
        case 'tool_use':
            return cliToolCallPartToTranscriptPart(part);
        case 'tool_result':
        case 'tool_output':
            return cliToolOutputPartToTranscriptPart(part);
        default:
            return null;
    }
};

const getCliLineParts = (raw: Record<string, JsonValue>): Record<string, JsonValue>[] => {
    const parts = Array.isArray(raw.parts)
        ? raw.parts
        : (asObject(raw.message ?? null)?.content ?? (Array.isArray(raw.content) ? raw.content : null));
    if (Array.isArray(parts)) {
        return parts.flatMap((part) => {
            if (typeof part === 'string') {
                return [{ text: part, type: 'text' }];
            }
            const object = asObject(part);
            return object ? [object] : [];
        });
    }

    const content = asObject(raw.message ?? null)?.content ?? raw.content;
    if (typeof content === 'string') {
        return [{ text: content, type: 'text' }];
    }
    return [];
};

const getCliLineRole = (raw: Record<string, JsonValue>): string => {
    return (
        asString(raw.role ?? null) ??
        asString(asObject(raw.message ?? null)?.role ?? null) ??
        asString(raw.type ?? null) ??
        'unknown'
    );
};

export const parseQoderCliTranscriptLine = (
    raw: Record<string, JsonValue>,
    lineIndex: number,
    sourcePath: string,
): QoderTranscriptEntry[] => {
    const role = getCliLineRole(raw);
    const timestamp = toIso(parseTimestampMs(raw.created_at ?? raw.timestamp ?? raw.updated_at));
    const parentId = asString(raw.id ?? raw.uuid ?? null) ?? `${sourcePath}:${lineIndex}`;
    return getCliLineParts(raw).flatMap((part, partIndex) => {
        const parsed = cliPartToTranscriptPart(part, role);
        if (!parsed) {
            return [];
        }

        return [
            {
                entryId: `${parentId}:${partIndex}`,
                entryType: parsed.entryType,
                parts: [
                    parseTextPart(
                        {
                            ...parsed.raw,
                            source: 'qoderCliTranscript',
                            sourcePath,
                        },
                        parsed.text,
                    ),
                ],
                raw,
                requestId: asString(raw.request_set_id ?? raw.requestSetId ?? null),
                role: parsed.role,
                timestamp,
            },
        ];
    });
};

export const getRawStringValue = (raw: Record<string, JsonValue>, keys: string[]): string | null => {
    for (const key of keys) {
        const value = asString(raw[key] ?? null);
        if (value?.trim()) {
            return value;
        }
    }

    return null;
};

const stringifyAcpValue = (value: JsonValue | undefined): string | null => {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (value === null || value === undefined) {
        return null;
    }

    return JSON.stringify(value, null, 2);
};

const getAcpContentText = (update: Record<string, JsonValue>): string | null => {
    const content = asObject(update.content ?? null);
    const data = asObject(update.data ?? null);
    return (
        getRawStringValue(content ?? {}, ['text', 'content', 'thinking']) ??
        getRawStringValue(data ?? {}, ['text', 'content', 'thinking', 'output']) ??
        getRawStringValue(update, ['text', 'content', 'thinking', 'message', 'delta'])
    );
};

const getAcpTimestamp = (update: Record<string, JsonValue>): string | null => {
    return toIso(parseTimestampMs(update.timestamp ?? update.created_at ?? update.createdAt ?? update.updated_at));
};

const buildAcpMessageEntry = (
    event: QoderAcpSessionUpdate,
    index: number,
    role: 'assistant' | 'user',
): QoderTranscriptEntry | null => {
    const text = getAcpContentText(event.update);
    if (!text?.trim()) {
        return null;
    }

    return {
        entryId: `qoder-acp:${event.sessionId}:${index}`,
        entryType: 'message',
        parts: [
            parseTextPart(
                {
                    requestId: event.requestId,
                    sessionUpdate: event.update.sessionUpdate ?? null,
                    source: 'qoderAcpSessionLoad',
                },
                text,
            ),
        ],
        raw: event.update,
        requestId: event.requestId,
        role,
        timestamp: getAcpTimestamp(event.update),
    };
};

const getAcpToolId = (update: Record<string, JsonValue>, index: number): string => {
    return (
        getRawStringValue(update, ['toolCallId', 'tool_call_id', 'callId', 'id']) ??
        getRawStringValue(asObject(update.toolCall ?? null) ?? {}, ['id', 'toolCallId']) ??
        `tool:${index}`
    );
};

const getAcpToolName = (update: Record<string, JsonValue>): string => {
    return (
        getRawStringValue(update, ['toolName', 'name', 'title', 'kind']) ??
        getRawStringValue(asObject(update.toolCall ?? null) ?? {}, ['toolName', 'name', 'title', 'kind']) ??
        'qoder_tool'
    );
};

const buildAcpToolCallText = (update: Record<string, JsonValue>): string | null => {
    const toolCall = asObject(update.toolCall ?? null);
    const name = getAcpToolName(update);
    const input =
        stringifyAcpValue(update.input) ??
        stringifyAcpValue(update.arguments) ??
        stringifyAcpValue(update.rawInput) ??
        stringifyAcpValue(toolCall?.input) ??
        stringifyAcpValue(toolCall?.arguments);
    return [name, input].filter((value): value is string => Boolean(value?.trim())).join('\n') || null;
};

const buildAcpToolOutputText = (update: Record<string, JsonValue>): string | null => {
    const text =
        getAcpContentText(update) ??
        stringifyAcpValue(update.output) ??
        stringifyAcpValue(update.result) ??
        stringifyAcpValue(update.rawOutput);
    return text?.trim() ? text : null;
};

const buildAcpToolEntry = (
    event: QoderAcpSessionUpdate,
    index: number,
    entryType: 'tool_call' | 'tool_output',
): QoderTranscriptEntry | null => {
    const text = entryType === 'tool_call' ? buildAcpToolCallText(event.update) : buildAcpToolOutputText(event.update);
    if (!text) {
        return null;
    }

    const toolCallId = getAcpToolId(event.update, index);
    const toolName = getAcpToolName(event.update);
    return {
        entryId: `qoder-acp:${event.sessionId}:${toolCallId}:${index}`,
        entryType,
        parts: [
            parseTextPart(
                {
                    requestId: event.requestId,
                    sessionUpdate: event.update.sessionUpdate ?? null,
                    source: 'qoderAcpSessionLoad',
                    toolCallId,
                    toolName,
                },
                text,
            ),
        ],
        raw: event.update,
        requestId: event.requestId,
        role: 'tool',
        timestamp: getAcpTimestamp(event.update),
    };
};

export const parseQoderAcpTranscriptUpdate = (
    event: QoderAcpSessionUpdate,
    index: number,
): QoderTranscriptEntry | null => {
    switch (event.update.sessionUpdate) {
        case 'user_message_chunk':
            return buildAcpMessageEntry(event, index, 'user');
        case 'agent_thought_chunk':
        case 'agent_message_chunk':
            return buildAcpMessageEntry(event, index, 'assistant');
        case 'tool_call':
            return buildAcpToolEntry(event, index, 'tool_call');
        case 'tool_call_update':
            return buildAcpToolEntry(event, index, 'tool_output');
        default:
            return null;
    }
};

const getPartString = (part: QoderTranscriptPart, key: string): string | null => {
    const value = part.raw[key];
    return typeof value === 'string' && value.trim() ? value : null;
};

const partToMessages = (
    entry: QoderTranscriptEntry,
    part: QoderTranscriptPart,
    partIndex: number,
    finalEntryIds: Set<string>,
): ConversationMessage[] => {
    if (entry.entryType === 'tool_call') {
        const toolName = getPartString(part, 'toolName') ?? 'unknown';
        const callId = getPartString(part, 'toolCallId') ?? entry.entryId;
        return createTextMessage({
            createdAtMs: toDateMs(entry.timestamp),
            id: `${entry.entryId}:${partIndex}`,
            metadata: {
                requestId: entry.requestId,
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
        const callId = getPartString(part, 'toolCallId') ?? entry.entryId;
        const status = getPartString(part, 'status');
        return createTextMessage({
            createdAtMs: toDateMs(entry.timestamp),
            id: `${entry.entryId}:${partIndex}`,
            metadata: {
                requestId: entry.requestId,
                toolCallId: callId,
                toolName: getPartString(part, 'toolName'),
            },
            order: partIndex,
            phase: 'tool_output',
            role: 'tool',
            text: part.text,
            toolEvidence: {
                callId,
                command: null,
                durationMs: null,
                exitCode: null,
                inputText: null,
                name: toolName,
                namespace: toolName.includes('.') ? (toolName.split('.')[0] ?? null) : null,
                outputText: part.text ?? null,
                status: normalizeToolStatus(status),
                workdir: null,
            },
        });
    }

    return createTextMessage({
        createdAtMs: toDateMs(entry.timestamp),
        id: `${entry.entryId}:${partIndex}`,
        order: partIndex,
        phase: normalizeAssistantPhase(getQoderMessagePhase(entry, finalEntryIds), 'unknown'),
        role: normalizeRole(entry.role),
        text: part.text,
    });
};

export const normalizeQoderTranscriptEntries = (entries: QoderTranscriptEntry[]): ConversationMessage[] => {
    const finalEntryIds = getFinalQoderAssistantMessageEntryIds(entries);
    return finalizeMessages(
        entries.flatMap((entry) =>
            entry.parts.flatMap((part, partIndex) => partToMessages(entry, part, partIndex, finalEntryIds)),
        ),
    );
};

export const asJsonObject = (value: JsonValue | null): Record<string, JsonValue> | null => {
    return value === null ? null : asObject(value);
};
