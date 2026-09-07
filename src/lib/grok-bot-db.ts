import { randomUUID } from 'node:crypto';
import { lstat, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ACCOUNT_SLOT_KEY = 'sand.client.slice.client-meta.account-slot';
const ACCOUNT_KEY_PREFIX = 'sand.client.slice.account';
const MAX_GROK_BOT_BLOB_BYTES = 16 * 1024 * 1024;
const GROK_BOT_PERSISTENCE_ENV = 'SPIRACHA_GROK_BOT_PERSISTENCE_DIR';

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

const asRecord = (value: unknown): Record<string, unknown> | null => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
};

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

const missingFile = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

const readableBlobPath = async (filePath: string, label: string): Promise<string | null> => {
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
        stats = await lstat(filePath);
    } catch (error) {
        if (missingFile(error)) {
            return null;
        }
        throw new Error(
            `Unable to inspect Grok Bot ${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    if (!stats.isFile()) {
        throw new Error(`Grok Bot ${label} must be a regular file.`);
    }
    if (stats.size > MAX_GROK_BOT_BLOB_BYTES) {
        throw new Error(`Grok Bot ${label} exceeds the ${MAX_GROK_BOT_BLOB_BYTES}-byte limit.`);
    }

    return filePath;
};

const readJsonBlob = async (filePath: string, label: string): Promise<unknown | null> => {
    const readablePath = await readableBlobPath(filePath, label);
    if (!readablePath) {
        return null;
    }

    const text = await Bun.file(readablePath).text();
    if (Buffer.byteLength(text) > MAX_GROK_BOT_BLOB_BYTES) {
        throw new Error(`Grok Bot ${label} exceeds the ${MAX_GROK_BOT_BLOB_BYTES}-byte limit.`);
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error(`Grok Bot ${label} is not valid JSON.`);
    }
};

const envelopeValue = (value: unknown, schemaVersion: number, label: string): unknown => {
    const envelope = asRecord(value);
    if (!envelope || envelope.schemaVersion !== schemaVersion || !('value' in envelope)) {
        throw new Error(`Grok Bot ${label} is incompatible.`);
    }
    return envelope.value;
};

const accountKey = (accountSlot: string, suffix: string) =>
    `${ACCOUNT_KEY_PREFIX}.${encodeURIComponent(accountSlot)}.${suffix}`;

const readAccountSlot = async (persistenceDir: string): Promise<string | null> => {
    const value = await readJsonBlob(getGrokBotPersistenceFilePath(persistenceDir, ACCOUNT_SLOT_KEY), 'account slot');
    if (value === null) {
        return null;
    }

    const accountSlot = envelopeValue(value, 1, 'account slot');
    if (typeof accountSlot !== 'string' || !accountSlot.trim()) {
        throw new Error('Grok Bot account slot is incompatible.');
    }
    return accountSlot;
};

const parseRosterRow = (value: unknown, index: number): GrokBotRosterRow => {
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

    return {
        createdAtMs: toTimestampMs(record.createdAtMs ?? record.createdAt),
        description: readOptionalString(record, 'description'),
        id: record.id,
        isGroup: record.isGroup === true,
        lastActivityAtMs: toTimestampMs(record.lastActivityAtMs ?? record.lastActivityAt),
        memberIds: (record.memberIds ?? []) as string[],
        name: record.name,
        title: readOptionalString(record, 'title'),
        updatedAtMs: toTimestampMs(record.updatedAtMs ?? record.updatedAt),
    };
};

const readRoster = async (persistenceDir: string) => {
    const accountSlot = await readAccountSlot(persistenceDir);
    if (!accountSlot) {
        return null;
    }

    const rosterPath = getGrokBotPersistenceFilePath(persistenceDir, accountKey(accountSlot, 'roster.last-roster'));
    const value = await readJsonBlob(rosterPath, 'roster');
    if (value === null) {
        return null;
    }

    const rosterEnvelope = asRecord(value);
    if (!rosterEnvelope) {
        throw new Error('Grok Bot roster is incompatible.');
    }
    const rosterValue = asRecord(envelopeValue(rosterEnvelope, 4, 'roster'));
    if (!rosterValue || !Array.isArray(rosterValue.rows)) {
        throw new Error('Grok Bot roster is incompatible.');
    }

    const rows = rosterValue.rows.map(parseRosterRow);
    if (new Set(rows.map((row) => row.id)).size !== rows.length) {
        throw new Error('Grok Bot roster contains duplicate conversation ids.');
    }
    return { accountSlot, rosterEnvelope, rosterPath, rosterValue, rows };
};

const writeRosterRows = async (
    rosterPath: string,
    rosterEnvelope: Record<string, unknown>,
    rosterValue: Record<string, unknown>,
    rows: GrokBotRosterRow[],
) => {
    const temporaryPath = `${rosterPath}.${randomUUID()}.tmp`;
    try {
        await Bun.write(
            temporaryPath,
            JSON.stringify({
                ...rosterEnvelope,
                value: { ...rosterValue, rows },
            }),
        );
        await rename(temporaryPath, rosterPath);
    } finally {
        await rm(temporaryPath, { force: true });
    }
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

const parseTranscript = (value: unknown): GrokBotTranscript => {
    const transcriptValue = asRecord(envelopeValue(value, 1, 'transcript replica'));
    if (!transcriptValue || !Array.isArray(transcriptValue.entries)) {
        throw new Error('Grok Bot transcript replica is incompatible.');
    }

    return {
        entries: transcriptValue.entries.map(parseTranscriptEntry),
        persistedAtMs: toTimestampMs(transcriptValue.persistedAtMs ?? transcriptValue.persistedAt),
    };
};

export const encodeGrokBotPersistenceKey = (value: string): string => {
    const bytes = new TextEncoder().encode(value);
    let buffer = 0;
    let bits = 0;
    let encoded = '';

    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            encoded += BASE32_ALPHABET[(buffer >> bits) & 31];
            buffer = bits === 0 ? 0 : buffer & ((1 << bits) - 1);
        }
    }

    if (bits > 0) {
        encoded += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
    }

    return encoded;
};

export const getGrokBotPersistenceFilePath = (persistenceDir: string, key: string): string =>
    path.join(persistenceDir, `${encodeGrokBotPersistenceKey(key)}.blob`);

export const resolveGrokBotPersistenceDir = (): string => {
    const configured = process.env[GROK_BOT_PERSISTENCE_ENV]?.trim();
    return (
        configured || path.join(os.homedir(), 'Library', 'Application Support', 'Grok Bot', 'sand-client-persistence')
    );
};

export const isGrokBotRunning = async (): Promise<boolean> => {
    const proc = Bun.spawn(['pgrep', '-x', 'Grok Bot'], { stderr: 'ignore', stdout: 'ignore' });
    return (await proc.exited) === 0;
};

export const listGrokBotConversations = async (
    persistenceDir = resolveGrokBotPersistenceDir(),
): Promise<GrokBotConversationSummary[]> => {
    const roster = await readRoster(persistenceDir);
    if (!roster) {
        return [];
    }

    return roster.rows.map((row) => ({
        id: row.id,
        roster: row,
        rosterRows: roster.rows,
    }));
};

export const readGrokBotConversation = async (
    persistenceDir: string,
    conversationId: string,
): Promise<GrokBotConversation | null> => {
    const roster = await readRoster(persistenceDir);
    const row = roster?.rows.find((candidate) => candidate.id === conversationId);
    if (!roster || !row) {
        return null;
    }

    const persistencePath = getGrokBotPersistenceFilePath(
        persistenceDir,
        accountKey(roster.accountSlot, `transcript.replicas.${conversationId}`),
    );
    const value = await readJsonBlob(persistencePath, 'transcript replica');
    if (value === null) {
        return null;
    }

    return {
        id: conversationId,
        persistencePath,
        roster: row,
        rosterRows: roster.rows,
        transcript: parseTranscript(value),
    };
};

export const findGrokBotConversationReplicaPath = async (
    persistenceDir: string,
    conversationId: string,
): Promise<string | null> => {
    const accountSlot = await readAccountSlot(persistenceDir);
    if (!accountSlot) {
        return null;
    }

    return readableBlobPath(
        getGrokBotPersistenceFilePath(persistenceDir, accountKey(accountSlot, `transcript.replicas.${conversationId}`)),
        'transcript replica',
    );
};

export const deleteGrokBotConversation = async (
    persistenceDir: string,
    conversationId: string,
    checkGrokBotRunning: () => Promise<boolean> = isGrokBotRunning,
) => {
    if (await checkGrokBotRunning()) {
        throw new Error(
            'Quit Grok Bot before deleting. It can rewrite chat history on exit, which can resurrect deleted chats.',
        );
    }

    const roster = await readRoster(persistenceDir);
    const row = roster?.rows.find((candidate) => candidate.id === conversationId);
    if (!roster || !row) {
        return { deletedFiles: [], deletedIds: [] };
    }

    const replicaPath = getGrokBotPersistenceFilePath(
        persistenceDir,
        accountKey(roster.accountSlot, `transcript.replicas.${conversationId}`),
    );
    const existingReplicaPath = await readableBlobPath(replicaPath, 'transcript replica');
    await writeRosterRows(
        roster.rosterPath,
        roster.rosterEnvelope,
        roster.rosterValue,
        roster.rows.filter((candidate) => candidate.id !== conversationId),
    );

    if (!existingReplicaPath) {
        return { deletedFiles: [], deletedIds: [conversationId] };
    }

    try {
        await rm(existingReplicaPath);
        return { deletedFiles: [existingReplicaPath], deletedIds: [conversationId] };
    } catch (error) {
        return {
            cleanupFailures: [
                {
                    error: error instanceof Error ? error.message : String(error),
                    path: existingReplicaPath,
                    phase: 'transcript-replica',
                },
            ],
            deletedFiles: [],
            deletedIds: [conversationId],
        };
    }
};
