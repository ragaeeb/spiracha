import { randomUUID } from 'node:crypto';
import { lstat, open, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GrokBotConversation, GrokBotConversationSummary } from './grok-bot-payload';
import { parseGrokBotRosterRow, parseGrokBotTranscript } from './grok-bot-payload';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ACCOUNT_SLOT_KEY = 'sand.client.slice.client-meta.account-slot';
const ACCOUNT_KEY_PREFIX = 'sand.client.slice.account';
const MAX_GROK_BOT_BLOB_BYTES = 16 * 1024 * 1024;
const GROK_BOT_PERSISTENCE_ENV = 'SPIRACHA_GROK_BOT_PERSISTENCE_DIR';

const asRecord = (value: unknown): Record<string, unknown> | null => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
};

const missingFile = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

const existingBlobPath = async (filePath: string, label: string, maximumBytes?: number): Promise<string | null> => {
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
    if (maximumBytes !== undefined && stats.size > maximumBytes) {
        throw new Error(`Grok Bot ${label} exceeds the ${maximumBytes}-byte limit.`);
    }

    return filePath;
};

const readableBlobPath = async (filePath: string, label: string): Promise<string | null> =>
    existingBlobPath(filePath, label, MAX_GROK_BOT_BLOB_BYTES);

const deletableBlobPath = async (filePath: string, label: string): Promise<string | null> =>
    existingBlobPath(filePath, label);

const syncPath = async (filePath: string, flags: string) => {
    const file = await open(filePath, flags);
    try {
        await file.sync();
    } finally {
        await file.close();
    }
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

    const rawRows = rosterValue.rows.map((row, index) => {
        const record = asRecord(row);
        if (!record) {
            throw new Error(`Grok Bot roster row ${index} is incompatible.`);
        }
        return record;
    });
    const rows = rawRows.map(parseGrokBotRosterRow);
    if (new Set(rows.map((row) => row.id)).size !== rows.length) {
        throw new Error('Grok Bot roster contains duplicate conversation ids.');
    }
    return { accountSlot, rawRows, rosterEnvelope, rosterPath, rosterValue, rows };
};

const writeRosterRows = async (
    rosterPath: string,
    rosterEnvelope: Record<string, unknown>,
    rosterValue: Record<string, unknown>,
    rows: Record<string, unknown>[],
) => {
    const temporaryPath = `${rosterPath}.${randomUUID()}.tmp`;
    try {
        const file = await open(temporaryPath, 'w');
        try {
            await file.writeFile(
                JSON.stringify({
                    ...rosterEnvelope,
                    value: { ...rosterValue, rows },
                }),
            );
            await file.sync();
        } finally {
            await file.close();
        }
        await rename(temporaryPath, rosterPath);
        await syncPath(path.dirname(rosterPath), 'r');
    } finally {
        await rm(temporaryPath, { force: true });
    }
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

type GrokBotProcess = Pick<ReturnType<typeof Bun.spawn>, 'exited'>;
type GrokBotProcessFactory = () => GrokBotProcess;

const spawnGrokBotProcess: GrokBotProcessFactory = () =>
    Bun.spawn(['pgrep', '-x', 'Grok Bot'], { stderr: 'ignore', stdout: 'ignore' });

const runningCheckUnavailable = (detail?: string): Error =>
    new Error(
        `Unable to verify whether Grok Bot is running${detail ? `: ${detail}` : ''}. Quit Grok Bot and retry before deleting.`,
    );

export const isGrokBotRunning = async (spawnProcess: GrokBotProcessFactory = spawnGrokBotProcess): Promise<boolean> => {
    let exitCode: number;
    try {
        exitCode = await spawnProcess().exited;
    } catch {
        throw runningCheckUnavailable();
    }

    if (exitCode === 0) {
        return true;
    }
    if (exitCode === 1) {
        return false;
    }
    throw runningCheckUnavailable(`pgrep exited with status ${exitCode}`);
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
        transcript: parseGrokBotTranscript(value),
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
    const roster = await readRoster(persistenceDir);
    const row = roster?.rows.find((candidate) => candidate.id === conversationId);
    if (!roster || !row) {
        return { deletedFiles: [], deletedIds: [] };
    }

    if (await checkGrokBotRunning()) {
        throw new Error(
            'Quit Grok Bot before deleting. It can rewrite chat history on exit, which can resurrect deleted chats.',
        );
    }

    const replicaPath = getGrokBotPersistenceFilePath(
        persistenceDir,
        accountKey(roster.accountSlot, `transcript.replicas.${conversationId}`),
    );
    const existingReplicaPath = await deletableBlobPath(replicaPath, 'transcript replica');
    await writeRosterRows(
        roster.rosterPath,
        roster.rosterEnvelope,
        roster.rosterValue,
        roster.rawRows.filter((candidate) => candidate.id !== conversationId),
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
