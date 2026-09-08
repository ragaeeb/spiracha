import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import type { GrokBotTranscriptEntry } from './grok-bot-payload';
import {
    grokBotTranscriptMetadata,
    normalizeGrokBotTranscript,
    parseGrokBotRosterRow,
    parseGrokBotTranscript,
} from './grok-bot-payload';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isReplica = (value: unknown): value is Record<string, unknown> =>
    isRecord(value) &&
    ((isRecord(value.value) && 'entries' in value.value) ||
        (Array.isArray(value.entries) &&
            value.entries.some((entry) => isRecord(entry) && typeof entry.kind === 'string')));

const validateMessageBodies = (entries: GrokBotTranscriptEntry[]) => {
    for (const entry of entries) {
        if (
            (entry.kind === 'message' || entry.kind === 'send-message') &&
            typeof entry.content !== 'string' &&
            !(isRecord(entry.message) && typeof entry.message.content === 'string')
        ) {
            throw new Error('Grok Bot message is missing its content.');
        }
    }
};

const parseReplica = (record: Record<string, unknown>): PayloadConversationDraft => {
    const transcript = parseGrokBotTranscript('schemaVersion' in record ? record : { schemaVersion: 1, value: record });
    validateMessageBodies(transcript.entries);
    const roster = record.roster === undefined ? undefined : parseGrokBotRosterRow(record.roster, 0);
    if (record.rosterRows !== undefined && !Array.isArray(record.rosterRows)) {
        throw new Error('Grok Bot rosterRows must be an array.');
    }
    const rosterRows = Array.isArray(record.rosterRows) ? record.rosterRows.map(parseGrokBotRosterRow) : [];
    const id = typeof record.id === 'string' && record.id.trim() ? record.id : (roster?.id ?? null);
    const summary = roster ? { id: roster.id, roster, rosterRows } : undefined;
    const metadata = grokBotTranscriptMetadata(summary, transcript);
    const timestamps = [
        roster?.lastActivityAtMs,
        roster?.updatedAtMs,
        transcript.persistedAtMs,
        ...transcript.entries.map((entry) => entry.timestampMs),
    ].filter((time): time is number => typeof time === 'number');
    return {
        createdAtMs: roster?.createdAtMs ?? null,
        id,
        messages: normalizeGrokBotTranscript(transcript.entries, metadata.chatKind),
        metadata,
        source: 'grok-bot',
        title: roster?.name ?? null,
        updatedAtMs: timestamps.length ? Math.max(...timestamps) : null,
    };
};

export const parseGrokBotPayload = (
    value: unknown,
    sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    let replicas: Record<string, unknown>[];
    if (isRecord(value) && value.schemaVersion === 4 && isRecord(value.value) && Array.isArray(value.value.rows)) {
        const rows = value.value.rows;
        const rosterRows = rows.map(parseGrokBotRosterRow);
        replicas = rows.map((row) => {
            if (!isRecord(row) || !isRecord(row.transcript)) {
                throw new Error('Grok Bot roster requires inline transcript bodies for payload conversion.');
            }
            return { roster: row, rosterRows, schemaVersion: 1, value: row.transcript };
        });
    } else if (Array.isArray(value) && value.some(isReplica)) {
        if (!value.every(isReplica)) {
            throw new Error('Grok Bot batch contains an invalid transcript.');
        }
        replicas = value;
    } else if (isReplica(value) || (sourceHint === 'grok-bot' && isRecord(value) && 'entries' in value)) {
        replicas = [value];
    } else {
        return null;
    }
    const drafts = replicas.map(parseReplica);
    const ids = drafts.flatMap((draft) => (draft.id ? [draft.id] : []));
    if (new Set(ids).size !== ids.length) {
        throw new Error('Grok Bot batch contains duplicate conversation ids.');
    }
    return drafts;
};
