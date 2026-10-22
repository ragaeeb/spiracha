import { toCanonicalMessage } from './conversation-data/adapter-helpers';
import type { ConversationMessage } from './conversation-data/types';
import type { PayloadConversationDraft } from './conversation-payload-types';

const SCHEMA = 'dot/transcript/v1';
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const timestamp = (value: unknown): number => {
    if (
        !isText(value) ||
        !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
            value,
        ) ||
        !Number.isFinite(Date.parse(value))
    ) {
        throw new Error('Dot transcript timestamps must be valid date strings.');
    }
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (Number(value.slice(0, 4)) === 0 || date.toISOString().slice(0, 10) !== value.slice(0, 10)) {
        throw new Error('Dot transcript timestamps require valid calendar dates.');
    }
    return Date.parse(value);
};
const validateModel = (record: Record<string, unknown>) => {
    if (
        (record.model !== undefined || record.modelSource !== undefined) &&
        (!isText(record.model) || record.modelSource !== 'user-configured')
    ) {
        throw new Error('Dot transcript models require a model and modelSource evidence pair.');
    }
};

const validateFields = (record: Record<string, unknown>, allowed: string[], kind: string) => {
    const unsupported = Object.keys(record).find((key) => !allowed.includes(key));
    if (unsupported) {
        throw new Error(`Unsupported dot transcript ${kind} field: ${unsupported}.`);
    }
};

const validateAttachment = (attachment: Record<string, unknown>) => {
    validateFields(attachment, ['id', 'name', 'mimeType', 'size'], 'attachment');
    if (!isText(attachment.id)) {
        throw new Error('Dot transcript attachments require an ID.');
    }
    for (const key of ['name', 'mimeType']) {
        if (attachment[key] !== undefined && !isText(attachment[key])) {
            throw new Error(`Dot transcript attachment ${key} must be a string.`);
        }
    }
    if (
        attachment.size !== undefined &&
        (typeof attachment.size !== 'number' || attachment.size < 0 || !Number.isSafeInteger(attachment.size))
    ) {
        throw new Error('Dot transcript attachment size must be a nonnegative safe integer.');
    }
};

const validateMessageMetadata = (entry: Record<string, unknown>) => {
    validateFields(
        entry,
        ['schemaVersion', 'type', 'id', 'sessionId', 'role', 'timestamp', 'text', 'replyToId', 'attachments'],
        'message',
    );
    if (entry.replyToId !== undefined && !isText(entry.replyToId)) {
        throw new Error('Dot transcript replyToId must be a nonempty string.');
    }
    if (entry.attachments !== undefined && (!Array.isArray(entry.attachments) || !entry.attachments.every(isRecord))) {
        throw new Error('Dot transcript attachments must contain metadata objects.');
    }
    if (Array.isArray(entry.attachments)) {
        for (const attachment of entry.attachments) {
            validateAttachment(attachment);
        }
    }
};

const validateCoverage = (coverage: Record<string, unknown>, messages: ConversationMessage[]) => {
    validateFields(
        coverage,
        ['scope', 'complete', 'messageCount', 'earliestMessageId', 'latestMessageId', 'description'],
        'coverage',
    );
    if (
        coverage.scope !== 'visible-room-messages' ||
        !isText(coverage.description) ||
        typeof coverage.complete !== 'boolean'
    ) {
        throw new Error(
            'Dot transcript coverage requires visible-room-messages scope, a description and boolean complete.',
        );
    }
    if (coverage.messageCount !== messages.length) {
        throw new Error('Dot transcript coverage.messageCount does not match supplied messages.');
    }
    const ordered = [...messages].sort(
        (a, b) => a.createdAtMs! - b.createdAtMs! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    if (coverage.earliestMessageId !== (ordered[0]?.id ?? '')) {
        throw new Error('Dot transcript coverage.earliestMessageId does not match supplied messages.');
    }
    if (coverage.latestMessageId !== (ordered.at(-1)?.id ?? '')) {
        throw new Error('Dot transcript coverage.latestMessageId does not match supplied messages.');
    }
};

/** Claim versioned dot exports before broad native/Web inference, including unsupported versions. */
export const isDotTranscriptRecord = (value: unknown): boolean =>
    isRecord(value) &&
    (value.source === 'dot' ||
        (typeof value.schemaVersion === 'string' && value.schemaVersion.startsWith('dot/transcript/')));

export const parseDotPayload = (value: unknown): PayloadConversationDraft[] | null => {
    const records = Array.isArray(value) ? value : [value];
    if (!records.some(isDotTranscriptRecord)) {
        return null;
    }
    const [session, ...entries] = records;
    if (
        !isRecord(session) ||
        session.schemaVersion !== SCHEMA ||
        session.type !== 'session' ||
        session.source !== 'dot' ||
        !isText(session.sessionId) ||
        !isText(session.name) ||
        !isRecord(session.coverage)
    ) {
        throw new Error('Dot transcript requires a dot/transcript/v1 session header with sessionId and coverage.');
    }
    validateFields(
        session,
        ['schemaVersion', 'type', 'source', 'sessionId', 'name', 'model', 'modelSource', 'exportedAt', 'coverage'],
        'session',
    );
    timestamp(session.exportedAt);
    validateModel(session);
    const sessionId = session.sessionId;
    const ids = new Set<string>();
    const messages: ConversationMessage[] = entries.map((entry, order) => {
        if (
            !isRecord(entry) ||
            entry.schemaVersion !== SCHEMA ||
            entry.type !== 'message' ||
            entry.sessionId !== sessionId ||
            !isText(entry.id) ||
            (entry.role !== 'user' && entry.role !== 'assistant') ||
            typeof entry.text !== 'string'
        ) {
            throw new Error(
                'Dot transcript messages require matching session identity, unique IDs, visible roles and text.',
            );
        }
        if (ids.has(entry.id)) {
            throw new Error(`Duplicate dot transcript message ID: ${entry.id}.`);
        }
        ids.add(entry.id);
        validateMessageMetadata(entry);
        return toCanonicalMessage({
            createdAtMs: timestamp(entry.timestamp),
            id: entry.id,
            metadata: { sourceRecord: entry },
            order,
            phase: entry.role === 'assistant' ? 'final_answer' : 'unknown',
            provenance: {
                blockIndex: null,
                branchId: null,
                origin: 'native',
                parentMessageId: typeof entry.replyToId === 'string' ? entry.replyToId : null,
                sourceConversationId: sessionId,
                sourceRecordId: entry.id,
            },
            role: entry.role,
            text: entry.text,
        });
    });
    validateCoverage(session.coverage, messages);
    const times = messages.map((message) => message.createdAtMs!);
    return [
        {
            createdAtMs: times.length ? times.reduce((a, b) => Math.min(a, b)) : null,
            id: sessionId,
            messages,
            metadata: {
                coverage: session.coverage,
                ...(session.model
                    ? { configuredModel: session.model, configuredModelSource: session.modelSource }
                    : {}),
                session,
            },
            source: 'dot',
            title: typeof session.name === 'string' ? session.name : null,
            updatedAtMs: times.length ? times.reduce((a, b) => Math.max(a, b)) : null,
        },
    ];
};
