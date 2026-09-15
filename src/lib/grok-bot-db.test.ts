import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import { mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteGrokBotConversation,
    encodeGrokBotPersistenceKey,
    getGrokBotPersistenceFilePath,
    isGrokBotRunning,
    listGrokBotConversations,
    readGrokBotConversation,
} from './grok-bot-db';

const CURRENT_ACCOUNT_SLOT = 'google-oauth2|user/01?reserved%value';
const KIWI_ID = 'bd5bbf01-a4e1-47f8-885f-f2188cf04aab';
const BAMBA_ID = '477a1920-782e-4470-944f-b808c21f0fde';
const KIWI_ROSTER_ROW = {
    avatarUrl: 'https://example.test/kiwi.png',
    createdAt: 1_700_000_000_000,
    description: 'Software Engineering',
    id: KIWI_ID,
    isGroup: false,
    name: 'Kiwi',
    title: 'Developer',
    unreadCount: 3,
};

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
                KIWI_ROSTER_ROW,
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
    it('should classify only pgrep statuses zero and one as running and stopped', async () => {
        const processWithExitCode = (exitCode: number) => () => ({ exited: Promise.resolve(exitCode) });

        await expect(isGrokBotRunning(processWithExitCode(0))).resolves.toBe(true);
        await expect(isGrokBotRunning(processWithExitCode(1))).resolves.toBe(false);
    });

    it('should fail closed when the Grok Bot running check is unavailable', async () => {
        const unavailableProcess = () => {
            throw new Error('spawn ENOENT');
        };
        const unexpectedExitProcess = () => ({ exited: Promise.resolve(2) });

        await expect(isGrokBotRunning(unavailableProcess)).rejects.toThrow(
            'Unable to verify whether Grok Bot is running',
        );
        await expect(isGrokBotRunning(unexpectedExitProcess)).rejects.toThrow(
            'Unable to verify whether Grok Bot is running',
        );
    });

    it('should encode persistence keys as unpadded lowercase base32', () => {
        expect(encodeGrokBotPersistenceKey('foo')).toBe('mzxw6');
        expect(encodeGrokBotPersistenceKey('f')).toBe('my');
        expect(encodeGrokBotPersistenceKey('sand.client.slice.client-meta.account-slot')).toBe(
            'onqw4zbomnwgszlooqxhg3djmnss4y3mnfsw45bnnvsxiyjomfrwg33vnz2c243mn52a',
        );
        expect(encodeGrokBotPersistenceKey(CURRENT_ACCOUNT_SLOT)).toBe(
            'm5xw6z3mmuww6ylvorude7dvonsxelzqge7xezltmvzhmzleev3gc3dvmu',
        );
        expect(
            encodeGrokBotPersistenceKey(
                `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}.transcript.replicas.${BAMBA_ID}`,
            ),
        ).toBe(
            'onqw4zbomnwgszlooqxhg3djmnss4yldmnxxk3tufztw633hnrss233bov2gqmrfg5bxk43foisterrqgestgrtsmvzwk4twmvsckmrvozqwy5lffz2heyloonrxe2lqoqxhezlqnruwgyltfy2don3bge4tembng44dezjngq2dombnhe2dizrnmi4daoddgiywmmdgmrsq',
        );
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
            await expect(deleteGrokBotConversation(root, 'missing-id', async () => true)).resolves.toEqual({
                deletedFiles: [],
                deletedIds: [],
            });
            await expect(listGrokBotConversations(root)).resolves.toHaveLength(2);
            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).resolves.toEqual({
                deletedFiles: [replicaPath],
                deletedIds: [BAMBA_ID],
            });
            expect(await Bun.file(replicaPath).exists()).toBe(false);
            const rosterPath = getGrokBotPersistenceFilePath(root, `${accountPrefix}.roster.last-roster`);
            await expect(Bun.file(rosterPath).json()).resolves.toEqual(
                expect.objectContaining({
                    value: expect.objectContaining({ rows: [KIWI_ROSTER_ROW] }),
                }),
            );
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

    it('should delete an oversized transcript replica without reading it', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-bot-db-delete-large-'));
        try {
            await writeFixture(root);
            const accountPrefix = `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}`;
            const replicaPath = getGrokBotPersistenceFilePath(root, `${accountPrefix}.transcript.replicas.${BAMBA_ID}`);
            await Bun.write(replicaPath, new Uint8Array(16 * 1024 * 1024 + 1));

            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).resolves.toEqual({
                deletedFiles: [replicaPath],
                deletedIds: [BAMBA_ID],
            });
            expect(await Bun.file(replicaPath).exists()).toBe(false);
            await expect(listGrokBotConversations(root)).resolves.toEqual([expect.objectContaining({ id: KIWI_ID })]);
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

describe('Grok Bot deletion recovery', () => {
    it('should retry a failed replica removal even after its roster row is gone', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-delete-retry-'));
        const originalRm = fs.rm;
        try {
            await writeFixture(root);
            const replica = getGrokBotPersistenceFilePath(
                root,
                `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}.transcript.replicas.${BAMBA_ID}`,
            );
            const remove = spyOn(fs, 'rm').mockImplementation(async (target, options) => {
                if (target === replica) {
                    throw new Error('replica busy');
                }
                return originalRm(target, options);
            });
            try {
                const result = await deleteGrokBotConversation(root, BAMBA_ID, async () => false);
                expect(result.deletedIds).toEqual([BAMBA_ID]);
                expect(result.cleanupFailures).toHaveLength(1);
                expect(await Bun.file(replica).exists()).toBe(true);
            } finally {
                remove.mockRestore();
            }
            expect((await readdir(root)).some((file) => file.startsWith('.spiracha-delete-'))).toBe(true);
            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).resolves.toEqual({
                deletedFiles: [replica],
                deletedIds: [BAMBA_ID],
            });
            expect((await readdir(root)).some((file) => file.startsWith('.spiracha-delete-'))).toBe(false);
            expect((await listGrokBotConversations(root)).map((row) => row.id)).toEqual([KIWI_ID]);
        } finally {
            await originalRm(root, { force: true, recursive: true });
        }
    });

    it('should preserve replica bytes and sibling rows when roster replacement fails', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-delete-roster-'));
        const originalRename = fs.rename;
        try {
            await writeFixture(root);
            const roster = getGrokBotPersistenceFilePath(
                root,
                `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}.roster.last-roster`,
            );
            const move = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
                if (to === roster) {
                    throw new Error('roster busy');
                }
                return originalRename(from, to);
            });
            try {
                await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).rejects.toThrow(
                    'roster busy',
                );
            } finally {
                move.mockRestore();
            }
            expect(await listGrokBotConversations(root)).toHaveLength(2);
            expect(await readGrokBotConversation(root, BAMBA_ID)).not.toBeNull();
            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).resolves.toMatchObject({
                deletedIds: [BAMBA_ID],
            });
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    for (const phase of ['intent', 'roster', 'replica']) {
        it(`should resume after a process exits following the ${phase} phase`, async () => {
            const root = await mkdtemp(path.join(os.tmpdir(), 'grok-delete-crash-'));
            try {
                await writeFixture(root);
                const script = path.join(root, 'crash.test.ts');
                const modulePath = path.join(import.meta.dir, 'grok-bot-db.ts');
                await Bun.write(
                    script,
                    `import { test, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import { deleteGrokBotConversation } from ${JSON.stringify(modulePath)};
const rename = fs.rename;
const rm = fs.rm;
spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to);
    if (${JSON.stringify(phase)} === 'intent' && String(to).includes('.spiracha-delete-')) process.exit(71);
    if (${JSON.stringify(phase)} === 'roster' && String(to).endsWith('.blob')) process.exit(71);
});
spyOn(fs, 'rm').mockImplementation(async (target, options) => {
    await rm(target, options);
    if (${JSON.stringify(phase)} === 'replica' && String(target).endsWith('.blob')) process.exit(71);
});
test('crash', () => deleteGrokBotConversation(${JSON.stringify(root)}, ${JSON.stringify(BAMBA_ID)}, async () => false));
`,
                );
                const child = Bun.spawn([process.execPath, 'test', script], { stderr: 'pipe', stdout: 'ignore' });
                const errorText = new Response(child.stderr).text();
                expect(await child.exited, await errorText).toBe(71);
                await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).resolves.toMatchObject({
                    deletedIds: [BAMBA_ID],
                });
                await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).resolves.toEqual({
                    deletedFiles: [],
                    deletedIds: [],
                });
                expect((await listGrokBotConversations(root)).map((row) => row.id)).toEqual([KIWI_ID]);
            } finally {
                await rm(root, { force: true, recursive: true });
            }
        });
    }
    it('should refuse replacement replicas and symlinked receipts on retry', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-delete-changed-'));
        const originalRm = fs.rm;
        try {
            await writeFixture(root);
            const replica = getGrokBotPersistenceFilePath(
                root,
                `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}.transcript.replicas.${BAMBA_ID}`,
            );
            const remove = spyOn(fs, 'rm').mockImplementation(async (target, options) => {
                if (target === replica) {
                    throw new Error('busy');
                }
                return originalRm(target, options);
            });
            try {
                await deleteGrokBotConversation(root, BAMBA_ID, async () => false);
            } finally {
                remove.mockRestore();
            }
            await Bun.write(replica, 'new app data');
            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).rejects.toThrow(
                'replica changed',
            );
            expect(await Bun.file(replica).text()).toBe('new app data');
            const receipt = path.join(
                root,
                (await readdir(root)).find((file) => /^\.spiracha-delete-.*\.json$/u.test(file))!,
            );
            const saved = path.join(root, 'receipt-copy.json');
            await fs.rename(receipt, saved);
            await symlink(saved, receipt);
            await expect(deleteGrokBotConversation(root, BAMBA_ID, async () => false)).rejects.toThrow('regular file');
            expect(await Bun.file(saved).exists()).toBe(true);
        } finally {
            await originalRm(root, { force: true, recursive: true });
        }
    });

    it('should re-read sibling roster changes made before the stopped-app check completes', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-delete-reread-'));
        try {
            await writeFixture(root);
            const rosterPath = getGrokBotPersistenceFilePath(
                root,
                `sand.client.slice.account.${encodeURIComponent(CURRENT_ACCOUNT_SLOT)}.roster.last-roster`,
            );
            await deleteGrokBotConversation(root, BAMBA_ID, async () => {
                const roster = await Bun.file(rosterPath).json();
                roster.value.rows[0].name = 'Updated sibling';
                await Bun.write(rosterPath, JSON.stringify(roster));
                return false;
            });
            expect((await Bun.file(rosterPath).json()).value.rows[0].name).toBe('Updated sibling');
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
    it('should report the receipt path when only receipt cleanup remains', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'grok-delete-receipt-'));
        const originalRm = fs.rm;
        try {
            await writeFixture(root);
            const remove = spyOn(fs, 'rm').mockImplementation(async (target, options) => {
                if (String(target).endsWith('.json')) {
                    throw new Error('receipt busy');
                }
                return originalRm(target, options);
            });
            try {
                const result = await deleteGrokBotConversation(root, KIWI_ID, async () => false);
                expect(result.deletedIds).toEqual([KIWI_ID]);
                expect(result.cleanupFailures?.[0]).toMatchObject({
                    path: expect.stringMatching(/\.spiracha-delete-.*\.json$/u),
                    phase: 'deletion-intent',
                });
            } finally {
                remove.mockRestore();
            }
            await expect(deleteGrokBotConversation(root, KIWI_ID, async () => false)).resolves.toEqual({
                deletedFiles: [],
                deletedIds: [KIWI_ID],
            });
        } finally {
            await originalRm(root, { force: true, recursive: true });
        }
    });
});
