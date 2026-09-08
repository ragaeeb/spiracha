import { normalizeClineTranscriptMessages, parseClineSessionMessages } from './cline-transcript-parser';
import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
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

const hasClineEnvelopeField = (value: Record<string, unknown>): boolean =>
    ['session_id', 'sessionId', 'agent', 'workspace_root'].some((key) => key in value);

const getArrayMessageRecords = (value: unknown, sourceHint?: ConversationPayloadSource) => {
    if (!Array.isArray(value)) {
        return null;
    }
    if (!value.every(isRecord)) {
        if (sourceHint === 'cline') {
            throw new Error('Cline payload message entries must be objects.');
        }
        return null;
    }
    return sourceHint === 'cline' ? (value as Record<string, unknown>[]) : null;
};

const getEnvelopeMessageRecords = (value: Record<string, unknown>, sourceHint?: ConversationPayloadSource) => {
    if (!Array.isArray(value.messages)) {
        if (sourceHint === 'cline' || hasClineEnvelopeField(value)) {
            throw new Error('Cline payload messages must be an array.');
        }
        return null;
    }
    if (!value.messages.every(isRecord)) {
        if (sourceHint === 'cline' || hasClineEnvelopeField(value)) {
            throw new Error('Cline payload message entries must be objects.');
        }
        return null;
    }
    const records = value.messages as Record<string, unknown>[];
    if (!hasClineEnvelopeField(value) && sourceHint !== 'cline') {
        return null;
    }
    return records;
};

const getMessageRecords = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): Record<string, unknown>[] | null => {
    if (sourceHint && sourceHint !== 'cline') {
        return null;
    }
    if (Array.isArray(value)) {
        return getArrayMessageRecords(value, sourceHint);
    }
    return isRecord(value) && 'messages' in value ? getEnvelopeMessageRecords(value, sourceHint) : null;
};

const validateMessages = (messages: Record<string, unknown>[]): void => {
    if (messages.length === 0) {
        throw new Error('Cline payload has no messages.');
    }
    messages.forEach((message) => {
        if (!Array.isArray(message.content)) {
            throw new Error('Cline payload message content must be an array.');
        }
        message.content.forEach((part) => {
            if (!isRecord(part) || typeof part.type !== 'string') {
                throw new Error('Cline payload message part is malformed.');
            }
        });
    });
};

const firstMessageText = (messages: ReturnType<typeof normalizeClineTranscriptMessages>): string | null =>
    messages.find((message) => message.role === 'user' && message.text.trim())?.text.trim() ?? null;

const getClineTimes = (
    envelope: Record<string, unknown>,
    messages: ReturnType<typeof normalizeClineTranscriptMessages>,
) => {
    const messageTimes = messages.map((message) => message.createdAtMs).filter((time): time is number => time !== null);
    return {
        createdAtMs:
            parseTimestampMs(envelope.started_at ?? envelope.created_at ?? envelope.createdAt) ??
            (messageTimes.length > 0 ? Math.min(...messageTimes) : null),
        updatedAtMs:
            parseTimestampMs(envelope.ended_at ?? envelope.updated_at ?? envelope.updatedAt) ??
            (messageTimes.length > 0 ? Math.max(...messageTimes) : null),
    };
};

const parseClineMessages = (
    value: unknown,
    records: Record<string, unknown>[],
    workspacePath: string | null,
    sessionId: string | null,
) => {
    validateMessages(records);
    const envelope = isRecord(value) ? value : {};
    const messages = normalizeClineTranscriptMessages(
        parseClineSessionMessages(
            envelope.messages ? (envelope as unknown as JsonValue) : ({ messages: records } as JsonValue),
            workspacePath ?? '',
            sessionId ?? 'payload',
            true,
        ),
    );
    if (messages.length === 0) {
        throw new Error('Cline payload contains no renderable messages.');
    }
    return messages;
};

export const parseClinePayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    const records = getMessageRecords(value, sourceHint);
    if (!records) {
        return null;
    }
    const envelope = isRecord(value) ? value : {};
    const sessionId = getString(envelope, 'session_id', 'sessionId');
    const metadata = isRecord(envelope.metadata) ? envelope.metadata : {};
    const model = getString(metadata, 'modelId', 'model', 'modelName') ?? getString(envelope, 'model', 'modelId');
    const workspacePath = getString(envelope, 'workspace_root', 'workspacePath', 'cwd');
    const messages = parseClineMessages(value, records, workspacePath, sessionId);

    const { createdAtMs, updatedAtMs } = getClineTimes(envelope, messages);
    const title = getString(metadata, 'title') ?? getString(envelope, 'title', 'prompt') ?? firstMessageText(messages);

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
            source: 'cline',
        },
    ];
};
