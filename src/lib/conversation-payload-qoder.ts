import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import type { QoderAcpSessionUpdate } from './qoder-acp-client';
import {
    normalizeQoderModelLabel,
    normalizeQoderTranscriptEntries,
    parseQoderAcpTranscriptUpdate,
    parseQoderCliTranscriptLine,
} from './qoder-transcript-parser';
import { coalesceQoderMessageChunks } from './qoder-transcript-phase';
import type { JsonValue } from './shared-text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const getString = (record: Record<string, unknown>, ...keys: string[]): string | null => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
};

const parseTimestampMs = (value: unknown): number | null => {
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

const asJsonRecord = (value: Record<string, unknown>): Record<string, JsonValue> => value as Record<string, JsonValue>;

const QODER_PART_TYPES = new Set([
    'text',
    'reasoning',
    'thinking',
    'tool_call',
    'tool_use',
    'tool_result',
    'tool_output',
]);

const hasQoderMarker = (record: Record<string, unknown>): boolean =>
    record.provider === 'qoder' ||
    record.source === 'qoder' ||
    'session_id' in record ||
    'sessionId' in record ||
    'request_set_id' in record ||
    'requestSetId' in record;

const hasQoderPart = (value: unknown): boolean =>
    isRecord(value) && typeof value.type === 'string' && QODER_PART_TYPES.has(value.type);

const hasCliShape = (record: Record<string, unknown>): boolean =>
    hasQoderMarker(record) &&
    (Array.isArray(record.parts) ||
        (isRecord(record.message) &&
            Array.isArray(record.message.content) &&
            record.message.content.some(hasQoderPart)) ||
        'content' in record);

const getAcpRecord = (record: Record<string, unknown>) => {
    const params = isRecord(record.params) ? record.params : null;
    const update = isRecord(record.update) ? record.update : isRecord(params?.update) ? params.update : record;
    return { params, update };
};

const hasAcpShape = (record: Record<string, unknown>): boolean => {
    const { update } = getAcpRecord(record);
    return typeof update.sessionUpdate === 'string';
};

const getArrayCollection = (value: unknown, sourceHint?: ConversationPayloadSource) => {
    if (!Array.isArray(value)) {
        return null;
    }
    const native = value.some((entry) => isRecord(entry) && (hasCliShape(entry) || hasAcpShape(entry)));
    if (!native && sourceHint !== 'qoder') {
        return null;
    }
    if (!value.every(isRecord)) {
        throw new Error('Qoder payload entries must be objects.');
    }
    return { envelope: {}, records: value as Record<string, unknown>[] };
};

const getObjectCollection = (value: Record<string, unknown>, sourceHint?: ConversationPayloadSource) => {
    const collectionKey = ['entries', 'events', 'messages', 'records'].find((key) => key in value);
    if (collectionKey) {
        const collection = value[collectionKey];
        const native =
            sourceHint === 'qoder' ||
            (Array.isArray(collection) &&
                collection.some((entry) => isRecord(entry) && (hasCliShape(entry) || hasAcpShape(entry))));
        if (!native) {
            return null;
        }
        if (!Array.isArray(collection)) {
            throw new Error(`Qoder payload ${collectionKey} must be an array.`);
        }
        if (!collection.every(isRecord)) {
            throw new Error(`Qoder payload ${collectionKey} entries must be objects.`);
        }
        return { envelope: value, records: collection as Record<string, unknown>[] };
    }
    if (hasCliShape(value) || hasAcpShape(value) || sourceHint === 'qoder') {
        return { envelope: value, records: [value] };
    }
    return null;
};

const getCollection = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): { envelope: Record<string, unknown>; records: Record<string, unknown>[] } | null => {
    if (sourceHint && sourceHint !== 'qoder') {
        return null;
    }
    const arrayCollection = getArrayCollection(value, sourceHint);
    if (arrayCollection) {
        return arrayCollection;
    }
    return Array.isArray(value) || !isRecord(value) ? null : getObjectCollection(value, sourceHint);
};

const toAcpEvent = (record: Record<string, unknown>, index: number): QoderAcpSessionUpdate | null => {
    const { params, update } = getAcpRecord(record);
    if (typeof update.sessionUpdate !== 'string') {
        return null;
    }
    const meta = isRecord(params?._meta) ? params._meta : null;
    const sessionId =
        getString(record, 'sessionId', 'session_id') ??
        getString(params ?? {}, 'sessionId', 'session_id') ??
        getString(update, 'sessionId') ??
        `payload-${index}`;
    return {
        requestId:
            getString(record, 'requestId', 'request_id') ??
            getString(params ?? {}, 'requestId', 'request_id') ??
            getString(meta ?? {}, 'ai-coding/request-id'),
        sessionId,
        update: asJsonRecord(update),
    };
};

const getModel = (records: Record<string, unknown>[]): string | null => {
    for (const record of records) {
        const model = getString(record, 'model', 'modelId', 'modelName', 'selectedModel');
        if (model && model !== 'auto') {
            return normalizeQoderModelLabel(model);
        }
        const { update } = getAcpRecord(record);
        const updateModel = getString(update, 'modelId', 'model', 'modelName');
        if (updateModel) {
            return normalizeQoderModelLabel(updateModel);
        }
    }
    return null;
};

const getRecordSessionId = (record: Record<string, unknown>): string | null => {
    const { params, update } = getAcpRecord(record);
    return (
        getString(record, 'sessionId', 'session_id', 'conversationId') ??
        getString(params ?? {}, 'sessionId', 'session_id', 'conversationId') ??
        getString(update, 'sessionId', 'session_id', 'conversationId')
    );
};

const firstText = (messages: PayloadConversationDraft['messages'], role: string): string | null =>
    messages.find((message) => message.role === role && message.text.trim())?.text.trim() ?? null;

const parseQoderMessages = (records: Record<string, unknown>[]) => {
    const entries = coalesceQoderMessageChunks(
        records.flatMap((record, index) => {
            const acpEvent = toAcpEvent(record, index);
            if (acpEvent) {
                const entry = parseQoderAcpTranscriptUpdate(acpEvent, index);
                return entry ? [entry] : [];
            }
            return parseQoderCliTranscriptLine(asJsonRecord(record), index, 'payload');
        }),
    );
    if (entries.length === 0) {
        throw new Error('Qoder payload contains no renderable transcript entries.');
    }
    const messages = normalizeQoderTranscriptEntries(entries);
    if (messages.length === 0) {
        throw new Error('Qoder payload contains no renderable messages.');
    }
    return { entries, messages };
};

const getQoderDraftTimes = (envelope: Record<string, unknown>, messages: PayloadConversationDraft['messages']) => {
    const times = messages.map((message) => message.createdAtMs).filter((time): time is number => time !== null);
    return {
        createdAtMs:
            parseTimestampMs(envelope.createdAt ?? envelope.created_at ?? envelope.createTime) ??
            (times.length > 0 ? Math.min(...times) : null),
        updatedAtMs:
            parseTimestampMs(envelope.updatedAt ?? envelope.updated_at ?? envelope.lastActiveAt) ??
            (times.length > 0 ? Math.max(...times) : null),
    };
};

const getQoderDraftValues = (
    envelope: Record<string, unknown>,
    records: Record<string, unknown>[],
    entries: ReturnType<typeof parseQoderMessages>['entries'],
    messages: PayloadConversationDraft['messages'],
) => {
    const sessionId =
        getString(envelope, 'sessionId', 'session_id', 'conversationId') ??
        records.map(getRecordSessionId).find(Boolean) ??
        null;
    const directModel = getString(envelope, 'model', 'modelId', 'modelName');
    const model = directModel ? normalizeQoderModelLabel(directModel) : getModel(records);
    const workspacePath = getString(envelope, 'workspacePath', 'workspace_path', 'worktree', 'cwd');
    const title = getString(envelope, 'title', 'name', 'query') ?? firstText(messages, 'user');
    const { createdAtMs, updatedAtMs } = getQoderDraftTimes(envelope, messages);
    const requestId = entries.find((entry) => entry.requestId)?.requestId ?? null;
    const metadata = requestId ? { requestId } : {};
    return { createdAtMs, metadata, model, requestId, sessionId, title, updatedAtMs, workspacePath };
};

const buildQoderDraft = (
    envelope: Record<string, unknown>,
    records: Record<string, unknown>[],
    entries: ReturnType<typeof parseQoderMessages>['entries'],
    messages: PayloadConversationDraft['messages'],
): PayloadConversationDraft => {
    const { createdAtMs, metadata, model, sessionId, title, updatedAtMs, workspacePath } = getQoderDraftValues(
        envelope,
        records,
        entries,
        messages,
    );

    return {
        ...(sessionId ? { id: sessionId } : {}),
        ...(title ? { title } : {}),
        ...(model ? { model } : {}),
        ...(createdAtMs !== null ? { createdAtMs } : {}),
        ...(updatedAtMs !== null ? { updatedAtMs } : {}),
        ...(workspacePath ? { workspacePath } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        messages,
        source: 'qoder',
    };
};

export const parseQoderPayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    const collection = getCollection(value, sourceHint);
    if (!collection) {
        return null;
    }
    if (collection.records.length === 0) {
        throw new Error('Qoder payload has no transcript entries.');
    }
    const { entries, messages } = parseQoderMessages(collection.records);
    return [buildQoderDraft(collection.envelope, collection.records, entries, messages)];
};
