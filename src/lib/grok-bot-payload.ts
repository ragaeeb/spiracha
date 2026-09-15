import { createTextMessage, normalizeRole } from './conversation-data/adapter-helpers';
import type { ConversationMessage } from './conversation-data/types';

export type GrokBotRosterRow = {
    createdAtMs: number | null;
    description: string | null;
    id: string;
    isGroup: boolean;
    lastActivityAtMs: number | null;
    memberIds: string[];
    name: string;
    title: string | null;
    updatedAtMs: number | null;
};

export type GrokBotTranscriptEntry = Record<string, unknown> & {
    id: string | null;
    kind: string;
    timestampMs: number | null;
};

export type GrokBotTranscript = {
    entries: GrokBotTranscriptEntry[];
    persistedAtMs: number | null;
};

export type GrokBotConversationSummary = {
    id: string;
    roster: GrokBotRosterRow;
    rosterRows: GrokBotRosterRow[];
};

export type GrokBotConversation = GrokBotConversationSummary & {
    persistencePath: string;
    transcript: GrokBotTranscript;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const asRecord = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);

const toTimestampMs = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    return Math.floor(value);
};

const readOptionalString = (record: Record<string, unknown>, key: string): string | null => {
    const value = record[key];
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new Error(`Grok Bot roster field "${key}" is incompatible.`);
    }
    return value;
};

export const parseGrokBotRosterRow = (value: unknown, index: number): GrokBotRosterRow => {
    const record = asRecord(value);
    if (!record || typeof record.id !== 'string' || !record.id.trim() || typeof record.name !== 'string') {
        throw new Error(`Grok Bot roster row ${index} is incompatible.`);
    }
    if (record.isGroup !== undefined && typeof record.isGroup !== 'boolean') {
        throw new Error(`Grok Bot roster row ${index} is incompatible.`);
    }
    if (
        record.memberIds !== undefined &&
        (!Array.isArray(record.memberIds) || record.memberIds.some((memberId) => typeof memberId !== 'string'))
    ) {
        throw new Error(`Grok Bot roster row ${index} is incompatible.`);
    }

    const memberIds = record.memberIds;
    return {
        createdAtMs: toTimestampMs(record.createdAtMs ?? record.createdAt),
        description: readOptionalString(record, 'description'),
        id: record.id,
        isGroup: record.isGroup === true,
        lastActivityAtMs: toTimestampMs(record.lastActivityAtMs ?? record.lastActivityAt),
        memberIds: Array.isArray(memberIds)
            ? memberIds.filter((memberId): memberId is string => typeof memberId === 'string')
            : [],
        name: record.name,
        title: readOptionalString(record, 'title'),
        updatedAtMs: toTimestampMs(record.updatedAtMs ?? record.updatedAt),
    };
};

const parseTranscriptEntry = (value: unknown, index: number): GrokBotTranscriptEntry => {
    const record = asRecord(value);
    if (!record || typeof record.kind !== 'string' || !record.kind.trim()) {
        throw new Error(`Grok Bot transcript entry ${index} is incompatible.`);
    }

    return {
        ...record,
        id: typeof record.id === 'string' && record.id.trim() ? record.id : null,
        kind: record.kind,
        timestampMs: toTimestampMs(record.timestampMs),
    };
};

export const parseGrokBotTranscript = (value: unknown): GrokBotTranscript => {
    const envelope = asRecord(value);
    const transcriptValue = envelope?.schemaVersion === 1 && 'value' in envelope ? asRecord(envelope.value) : null;
    if (!transcriptValue || !Array.isArray(transcriptValue.entries)) {
        throw new Error('Grok Bot transcript replica is incompatible.');
    }

    return {
        entries: transcriptValue.entries.map(parseTranscriptEntry),
        persistedAtMs: toTimestampMs(transcriptValue.persistedAtMs ?? transcriptValue.persistedAt),
    };
};

type SafeAgentRef = {
    id: string;
    kind?: string;
    name?: string;
};

const safeAgentRef = (value: unknown): SafeAgentRef | null => {
    const record = asRecord(value);
    if (!record || typeof record.id !== 'string' || !record.id.trim()) {
        return null;
    }

    return {
        id: record.id,
        ...(typeof record.kind === 'string' && record.kind ? { kind: record.kind } : {}),
        ...(typeof record.name === 'string' && record.name ? { name: record.name } : {}),
    };
};

const basename = (value: string): string => value.replace(/\\/gu, '/').split('/').at(-1) ?? value;

const safeAttachment = (entry: GrokBotTranscriptEntry) => {
    if (entry.kind !== 'user-attachment') {
        return null;
    }

    const fileName = typeof entry.file_name === 'string' ? basename(entry.file_name) : null;
    const byteSize = typeof entry.byteSize === 'number' && Number.isFinite(entry.byteSize) ? entry.byteSize : null;
    return {
        ...(fileName ? { fileName } : {}),
        ...(byteSize === null ? {} : { byteSize }),
    };
};

const entryText = (entry: GrokBotTranscriptEntry): string | null => {
    if (typeof entry.content === 'string') {
        return entry.content;
    }
    const message = asRecord(entry.message);
    return typeof message?.content === 'string' ? message.content : null;
};

const entryMessageMetadata = (entry: GrokBotTranscriptEntry, chatKind: 'direct' | 'group' | 'unknown') => {
    const author = safeAgentRef(entry.author);
    const toAgent = safeAgentRef(entry.toAgent);
    return {
        chatKind,
        entryKind: entry.kind,
        ...(author
            ? {
                  authorId: author.id,
                  ...(author.kind ? { authorKind: author.kind } : {}),
                  ...(author.name ? { authorName: author.name } : {}),
              }
            : {}),
        ...(toAgent
            ? {
                  toAgentId: toAgent.id,
                  ...(toAgent.kind ? { toAgentKind: toAgent.kind } : {}),
                  ...(toAgent.name ? { toAgentName: toAgent.name } : {}),
              }
            : {}),
    };
};

const messageId = (entry: GrokBotTranscriptEntry, index: number, usedIds: Map<string, number>) => {
    const baseId = entry.id ?? `entry-${index}`;
    const occurrence = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, occurrence + 1);
    return occurrence === 0 ? baseId : `${baseId}-${occurrence}`;
};

export const normalizeGrokBotTranscript = (
    entries: GrokBotTranscriptEntry[],
    chatKind: 'direct' | 'group' | 'unknown',
): ConversationMessage[] => {
    const usedIds = new Map<string, number>();
    return entries.flatMap((entry, index) => {
        if (entry.kind !== 'message' && entry.kind !== 'send-message') {
            return [];
        }

        const role =
            entry.kind === 'send-message'
                ? 'assistant'
                : normalizeRole(typeof entry.role === 'string' ? entry.role : undefined);
        return createTextMessage({
            createdAtMs: entry.timestampMs,
            id: messageId(entry, index, usedIds),
            metadata: entryMessageMetadata(entry, chatKind),
            order: index,
            phase: role === 'assistant' ? 'final_answer' : 'unknown',
            role,
            text: entryText(entry),
        });
    });
};

const memberMetadata = (conversation: GrokBotConversationSummary) =>
    conversation.roster.memberIds.flatMap((memberId) => {
        const member = conversation.rosterRows.find((row) => row.id === memberId);
        return member ? [{ id: member.id, name: member.name }] : [];
    });

export const grokBotTranscriptMetadata = (
    conversation?: GrokBotConversationSummary,
    transcript?: GrokBotTranscript,
) => {
    const chatKind: 'direct' | 'group' | 'unknown' = conversation
        ? conversation.roster.isGroup
            ? 'group'
            : 'direct'
        : 'unknown';
    const sourceEntryKinds = transcript ? [...new Set(transcript.entries.map((entry) => entry.kind))] : [];
    const attachments = transcript?.entries.flatMap((entry) => {
        const attachment = safeAttachment(entry);
        return attachment ? [attachment] : [];
    });
    const eventKinds = transcript
        ? [
              ...new Set(
                  transcript.entries
                      .filter((entry) => entry.kind === 'event')
                      .map((entry) =>
                          typeof entry.event === 'string'
                              ? entry.event
                              : typeof entry.type === 'string'
                                ? entry.type
                                : entry.kind,
                      ),
              ),
          ]
        : [];

    return {
        chatKind,
        lastActivityAtMs: conversation?.roster.lastActivityAtMs,
        replicaPersistedAtMs: transcript?.persistedAtMs,
        rosterUpdatedAtMs: conversation?.roster.updatedAtMs,
        ...(conversation?.roster.description ? { description: conversation.roster.description } : {}),
        ...(conversation?.roster.title ? { agentTitle: conversation.roster.title } : {}),
        memberIds: conversation?.roster.memberIds ?? [],
        members: conversation ? memberMetadata(conversation) : [],
        ...(sourceEntryKinds.length > 0 ? { sourceEntryKinds } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(eventKinds.length > 0 ? { eventKinds } : {}),
    };
};
