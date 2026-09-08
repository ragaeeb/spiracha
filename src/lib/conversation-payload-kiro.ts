import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import type { KiroTranscriptEntry } from './kiro-exporter-types';
import {
    mergeKiroTranscriptEntries,
    normalizeKiroTranscriptEntries,
    parseKiroExecutionEntries,
    parseKiroHistoryEntry,
} from './kiro-transcript-parser';
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

const firstText = (entries: PayloadConversationDraft['messages'], role: string): string | null =>
    entries.find((message) => message.role === role && message.text.trim())?.text.trim() ?? null;

const getArrayHistory = (
    value: unknown[],
    sourceHint?: ConversationPayloadSource,
): Record<string, unknown>[] | null => {
    if (!value.every(isRecord)) {
        if (sourceHint === 'kiro') {
            throw new Error('Kiro payload history entries must be objects.');
        }
        return null;
    }
    return sourceHint === 'kiro' ? (value as Record<string, unknown>[]) : null;
};

const getObjectHistory = (value: Record<string, unknown>): Record<string, unknown>[] | null => {
    if (!('history' in value)) {
        const hasExecutionWrapper = ['actions', 'executions', 'executionFiles', 'execution'].some(
            (key) => key in value,
        );
        if (!hasExecutionWrapper) {
            return null;
        }
        if ('actions' in value && !Array.isArray(value.actions)) {
            throw new Error('Kiro payload actions must be an array.');
        }
        return [];
    }
    if (!Array.isArray(value.history)) {
        throw new Error('Kiro payload history must be an array.');
    }
    if (!value.history.every(isRecord)) {
        throw new Error('Kiro payload history entries must be objects.');
    }
    return value.history as Record<string, unknown>[];
};

const getHistory = (value: unknown, sourceHint?: ConversationPayloadSource): Record<string, unknown>[] | null => {
    if (sourceHint && sourceHint !== 'kiro') {
        return null;
    }
    if (Array.isArray(value)) {
        return getArrayHistory(value, sourceHint);
    }
    return isRecord(value) ? getObjectHistory(value) : null;
};

const validateHistory = (history: Record<string, unknown>[]): void => {
    history.forEach((entry) => {
        const message = entry.message;
        if (!isRecord(message) || !('content' in message)) {
            throw new Error('Kiro payload history entry is missing a message.');
        }
        if (typeof message.content !== 'string' && !Array.isArray(message.content)) {
            throw new Error('Kiro payload message content is malformed.');
        }
    });
};

const getExecutionRecords = (envelope: Record<string, unknown>): Record<string, unknown>[] => {
    const candidates = envelope.executions ?? envelope.executionFiles ?? envelope.execution;
    if (candidates === undefined) {
        return [];
    }
    const values = Array.isArray(candidates) ? candidates : [candidates];
    if (!values.every(isRecord)) {
        throw new Error('Kiro payload execution entries must be objects.');
    }
    values.forEach((execution) => {
        if ('actions' in execution && !Array.isArray(execution.actions)) {
            throw new Error('Kiro payload execution actions must be an array.');
        }
        if (Array.isArray(execution.actions) && !execution.actions.every(isRecord)) {
            throw new Error('Kiro payload execution actions must be objects.');
        }
    });
    return values;
};

const parseKiroEntries = (
    history: Record<string, unknown>[],
    envelope: Record<string, unknown>,
): KiroTranscriptEntry[] => {
    validateHistory(history);
    if (Array.isArray(envelope.actions) && !envelope.actions.every(isRecord)) {
        throw new Error('Kiro payload actions must be objects.');
    }
    const historyEntries = history.flatMap((entry, index) => {
        const parsed = parseKiroHistoryEntry(asJsonRecord(entry), index);
        return parsed ? [parsed] : [];
    });
    const executionEntries = [
        ...(Array.isArray(envelope.actions) ? [asJsonRecord(envelope)] : []),
        ...getExecutionRecords(envelope).map(asJsonRecord),
    ].flatMap((execution) => parseKiroExecutionEntries(execution));
    return mergeKiroTranscriptEntries(historyEntries, executionEntries);
};

const getKiroMetadata = (envelope: Record<string, unknown>, sessionId: string | null): Record<string, unknown> => {
    const metadata: Record<string, unknown> = {};
    for (const key of ['autonomyMode', 'defaultModelTitle', 'selectedProfileId', 'sessionType']) {
        const text = getString(envelope, key);
        if (text) {
            metadata[key] = text;
        }
    }
    if (sessionId) {
        metadata.continuationSessionIds = [sessionId];
    }
    return metadata;
};

const getKiroTimes = (envelope: Record<string, unknown>, messages: PayloadConversationDraft['messages']) => {
    const times = messages.map((message) => message.createdAtMs).filter((time): time is number => time !== null);
    return {
        createdAtMs:
            parseTimestampMs(envelope.dateCreated ?? envelope.createdAt ?? envelope.created_at) ??
            (times.length > 0 ? Math.min(...times) : null),
        updatedAtMs:
            parseTimestampMs(
                envelope.updatedAt ?? envelope.updated_at ?? envelope.lastActiveAt ?? envelope.last_active_at,
            ) ?? (times.length > 0 ? Math.max(...times) : null),
    };
};

export const parseKiroPayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    const history = getHistory(value, sourceHint);
    if (!history) {
        return null;
    }
    const envelope = isRecord(value) ? value : {};
    if (history.length === 0 && Array.isArray(value)) {
        throw new Error('Kiro payload has no history entries.');
    }
    const entries = parseKiroEntries(history, envelope);
    if (entries.length === 0) {
        throw new Error('Kiro payload contains no renderable transcript entries.');
    }

    const messages = normalizeKiroTranscriptEntries(entries);
    if (messages.length === 0) {
        throw new Error('Kiro payload contains no renderable messages.');
    }

    const sessionId = getString(envelope, 'sessionId', 'session_id', 'id');
    const workspacePath = getString(envelope, 'workspacePath', 'workspaceDirectory', 'cwd');
    const model = getString(envelope, 'selectedModel', 'defaultModelTitle', 'model');
    const title = getString(envelope, 'title') ?? firstText(messages, 'user') ?? sessionId ?? null;
    const { createdAtMs, updatedAtMs } = getKiroTimes(envelope, messages);
    const metadata = getKiroMetadata(envelope, sessionId);

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
            source: 'kiro',
        },
    ];
};
