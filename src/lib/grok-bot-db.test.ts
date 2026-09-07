import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteGrokBotConversation,
    encodeGrokBotPersistenceKey,
    getGrokBotPersistenceFilePath,
    listGrokBotConversations,
    readGrokBotConversation,
} from './grok-bot-db';

const CURRENT_ACCOUNT_SLOT = 'google-oauth2|user/01?reserved%value';
const KIWI_ID = 'bd5bbf01-a4e1-47f8-885f-f2188cf04aab';
const BAMBA_ID = '477a1920-782e-4470-944f-b808c21f0fde';

const writePersistenceBlob = async (root: string, key: string, value: unknown, schemaVersion = 1) => {
    await Bun.write(getGrokBotPersistenceFilePath(root, key), JSON.stringify({ schemaVersion, value }));
};

const writeFixture = async (root: string) => {
    const accountPrefix = `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}`;
    await writePersistenceBlob(root, 'sand.client.slice.client-meta.account-slot', CURRENT_ACCOUNT_SLOT);
    await writePersistenceBlob(
        root,
        `${accountPrefix}.roster.last-roster`,
        {
            rows: [
                {
                    createdAt: 1_700_000_000_000,
                    description: 'Software Engineering',
                    id: KIWI_ID,
                    isGroup: false,
                    name: 'Kiwi',
                    title: 'Developer',
                },
                {
                    createdAt: 1_700_000_000_100,
                    id: BAMBA_ID,
                    isGroup: true,
                    memberIds: [KIWI_ID, 'safiyyah'],
                    name: 'Bamba Dev Team',
                },
            ],
        },
        4,
    );
    await writePersistenceBlob(
        root,
        'sand.client.slice.account.google-oauth2%7Cother.roster.last-roster',
        {
            rows: [{ id: 'other-account-row', isGroup: false, name: 'Should not be read' }],
        },
        4,
    );
    await writePersistenceBlob(root, `${accountPrefix}.transcript.replicas.${BAMBA_ID}`, {
        entries: [
            {
                content: 'footer showing up in prod',
                id: 'user-1',
                kind: 'message',
                role: 'user',
                timestampMs: 1_700_000_001_000,
            },
            {
                author: { id: 'kiwi', name: 'Kiwi' },
                id: 'agent-1',
                kind: 'send-message',
                message: { content: 'Terms, and Privacy are live in prod', type: 'text' },
                timestampMs: 1_700_000_001_100,
            },
        ],
        persistedAt: 1_700_000_001_100,
    });
};

describe('grok bot persistence', () => {
    it('should encode persistence keys as unpadded lowercase base32', () => {
        expect(encodeGrokBotPersistenceKey('foo')).toBe('mzxw6');
        expect(encodeGrokBotPersistenceKey('')).toBe('');
        expect(path.basename(getGrokBotPersistenceFilePath('/persist', 'roster.last-roster'))).toMatch(
            /^[a-z2-7]+\.blob$/u,
        );
    });

    it('should list only the active account roster without reading transcript replicas', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-bot-db-'));
        try {
            await writeFixture(root);
            const accountPrefix = `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}`;
            await Bun.write(
                getGrokBotPersistenceFilePath(root, `${accountPrefix}.transcript.replicas.${KIWI_ID}`),
                '{malformed transcript',
            );

            await expect(listGrokBotConversations(root)).resolves.toHaveLength(2);
            await expect(listGrokBotConversations(root)).resolves.toContainEqual(
                expect.objectContaining({ id: BAMBA_ID }),
            );
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('should delete one conversation replica and preserve the other roster rows', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-bot-db-delete-'));
        try {
            await writeFixture(root);
            const accountPrefix = `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}`;
            const replicaPath = getGrokBotPersistenceFilePath(root, `${accountPrefix}.transcript.replicas.${BAMBA_ID}`);

            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => true)).rejects.toThrow(
                'Quit Grok Bot before deleting',
            );
            await expect(listGrokBotConversations(root)).resolves.toHaveLength(2);
            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).resolves.toEqual({
                deletedFiles: [replicaPath],
                deletedIds: [BAMBA_ID],
            });
            expect(await Bun.file(replicaPath).exists()).toBe(false);
            await expect(listGrokBotConversations(root)).resolves.toEqual([expect.objectContaining({ id: KIWI_ID })]);
            await expect(readGrokBotConversation(root, BAMBA_ID)).resolves.toBeNull();
            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).resolves.toEqual({
                deletedFiles: [],
                deletedIds: [],
            });
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('should reject malformed active-account metadata and requested replicas', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-bot-db-invalid-'));
        try {
            await writePersistenceBlob(root, 'sand.client.slice.client-meta.account-slot', CURRENT_ACCOUNT_SLOT, 2);
            await expect(listGrokBotConversations(root)).rejects.toThrow('Grok Bot account slot');

            await writePersistenceBlob(root, 'sand.client.slice.client-meta.account-slot', CURRENT_ACCOUNT_SLOT);
            await writePersistenceBlob(
                root,
                `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}.roster.last-roster`,
                { rows: [{ id: KIWI_ID, isGroup: false, memberIds: ['valid', 1], name: 'Kiwi' }] },
                4,
            );
            await expect(listGrokBotConversations(root)).rejects.toThrow('roster row');
            await writePersistenceBlob(
                root,
                `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}.roster.last-roster`,
                { rows: [{ id: KIWI_ID, isGroup: false, name: 'Kiwi' }] },
                4,
            );
            await Bun.write(
                getGrokBotPersistenceFilePath(
                    root,
                    `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}.transcript.replicas.${KIWI_ID}`,
                ),
                '{malformed transcript',
            );
            await expect(readGrokBotConversation(root, KIWI_ID)).rejects.toThrow('transcript replica');
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
