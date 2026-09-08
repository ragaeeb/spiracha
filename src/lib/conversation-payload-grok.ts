import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import { normalizeGrokTranscriptEntries, parseGrokTranscriptEntry } from './grok-transcript-parser';
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

const GROK_TYPES = new Set(['assistant', 'reasoning', 'system', 'tool_result', 'user']);

const hasGrokType = (record: Record<string, unknown>): boolean =>
    typeof record.type === 'string' && GROK_TYPES.has(record.type);

const toGrokType = (record: Record<string, unknown>): string | null => {
    const type = typeof record.type === 'string' ? record.type : null;
    if (type && GROK_TYPES.has(type)) {
        return type;
    }
    if (typeof record.role === 'string') {
        if (GROK_TYPES.has(record.role)) {
            return record.role;
        }
        if (record.role === 'tool') {
            return 'tool_result';
        }
    }
    return null;
};

const getArrayRecords = (value: unknown, sourceHint?: ConversationPayloadSource) => {
    if (!Array.isArray(value)) {
        return null;
    }
    const native = value.some((entry) => isRecord(entry) && hasGrokType(entry));
    if (!native && sourceHint !== 'grok') {
        return null;
    }
    if (!value.every(isRecord)) {
        throw new Error('Grok payload entries must be objects.');
    }
    return value as Record<string, unknown>[];
};

const getCollectionRecords = (value: Record<string, unknown>, sourceHint?: ConversationPayloadSource) => {
    const collectionKey = ['chat_history', 'events', 'entries', 'messages'].find((key) => key in value);
    if (!collectionKey) {
        return null;
    }
    const collection = value[collectionKey];
    const native =
        collectionKey === 'chat_history' ||
        sourceHint === 'grok' ||
        (Array.isArray(collection) && collection.some((entry) => isRecord(entry) && hasGrokType(entry)));
    if (!native) {
        return null;
    }
    if (!Array.isArray(collection)) {
        throw new Error(`Grok payload ${collectionKey} must be an array.`);
    }
    if (!collection.every(isRecord)) {
        throw new Error(`Grok payload ${collectionKey} entries must be objects.`);
    }
    return collection as Record<string, unknown>[];
};

const getRecords = (value: unknown, sourceHint?: ConversationPayloadSource): Record<string, unknown>[] | null => {
    if (sourceHint && sourceHint !== 'grok') {
        return null;
    }
    const arrayRecords = getArrayRecords(value, sourceHint);
    if (arrayRecords) {
        return arrayRecords;
    }
    if (Array.isArray(value) || !isRecord(value)) {
        return null;
    }
    const collectionRecords = getCollectionRecords(value, sourceHint);
    if (collectionRecords) {
        return collectionRecords;
    }
    return sourceHint === 'grok' || hasGrokType(value) ? [value] : null;
};

const normalizeRecordType = (record: Record<string, unknown>): Record<string, unknown> => {
    const type = toGrokType(record);
    return type && record.type !== type ? { ...record, type } : record;
};

const firstText = (messages: PayloadConversationDraft['messages'], role: string): string | null =>
    messages.find((message) => message.role === role && message.text.trim())?.text.trim() ?? null;

const getGrokTimes = (envelope: Record<string, unknown>, messages: PayloadConversationDraft['messages']) => {
    const times = messages.map((message) => message.createdAtMs).filter((time): time is number => time !== null);
    return {
        createdAtMs:
            parseTimestampMs(envelope.created_at ?? envelope.createdAt) ??
            (times.length > 0 ? Math.min(...times) : null),
        updatedAtMs:
            parseTimestampMs(
                envelope.last_active_at ?? envelope.lastActiveAt ?? envelope.updated_at ?? envelope.updatedAt,
            ) ?? (times.length > 0 ? Math.max(...times) : null),
    };
};

const parseGrokMessages = (records: Record<string, unknown>[], sessionId: string | null) => {
    if (records.length === 0) {
        throw new Error('Grok payload has no transcript entries.');
    }
    const internalId = sessionId ?? 'payload';
    const entries = records.flatMap((record, index) => {
        const raw = normalizeRecordType(record);
        const parsed = parseGrokTranscriptEntry(asJsonRecord(raw), internalId, index, true);
        return parsed ? [parsed] : [];
    });
    if (entries.length === 0) {
        throw new Error('Grok payload contains no renderable transcript entries.');
    }
    const messages = normalizeGrokTranscriptEntries(entries);
    if (messages.length === 0) {
        throw new Error('Grok payload contains no renderable messages.');
    }
    return { entries, messages };
};

export const parseGrokPayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    const records = getRecords(value, sourceHint);
    if (!records) {
        return null;
    }
    const envelope = isRecord(value) ? value : {};
    const sessionId =
        getString(envelope, 'sessionId', 'session_id', 'conversationId') ??
        (isRecord(envelope.info) ? getString(envelope.info, 'id', 'sessionId') : null);
    const { entries, messages } = parseGrokMessages(records, sessionId);

    const info = isRecord(envelope.info) ? envelope.info : {};
    const model =
        getString(envelope, 'current_model_id', 'currentModelId', 'model') ??
        entries.findLast((entry) => entry.modelId)?.modelId ??
        null;
    const workspacePath = getString(envelope, 'cwd', 'workspacePath', 'worktree') ?? getString(info, 'cwd', 'worktree');
    const title = getString(envelope, 'generated_title', 'generatedTitle', 'title') ?? firstText(messages, 'user');
    const { createdAtMs, updatedAtMs } = getGrokTimes(envelope, messages);
    const metadata = Object.fromEntries(
        [
            ['agentName', getString(envelope, 'agent_name', 'agentName')],
            ['gitBranch', getString(envelope, 'head_branch', 'gitBranch')],
            ['headCommit', getString(envelope, 'head_commit', 'headCommit')],
            ['sandboxProfile', getString(envelope, 'sandbox_profile', 'sandboxProfile')],
        ].filter((entry): entry is [string, string] => entry[1] !== null),
    );

    return [
        {
            ...(sessionId ? { id: sessionId } : {}),
            ...(title ? { title } : {}),
            ...(model ? { model } : {}),
            ...(createdAtMs !== null ? { createdAtMs } : {}),
            ...(updatedAtMs !== null ? { updatedAtMs } : {}),
            ...(workspacePath ? { workspacePath } : {}),
            ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
            messages,
            source: 'grok',
        },
    ];
};
