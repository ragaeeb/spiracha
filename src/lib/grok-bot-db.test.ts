import { describe, expect, it, spyOn } from 'bun:test';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
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

const writeGatewaySession = async (appDir: string, scenario: string, id: string) => {
    const cipher = createCipheriv(
        'aes-128-cbc',
        pbkdf2Sync('fixture-secret', 'saltysalt', 1003, 16, 'sha1'),
        Buffer.alloc(16, 32),
    );
    const clear = JSON.stringify({
        baseUrl: scenario === 'untrusted' ? 'https://cursor.sh.attacker.test' : 'https://fixture.cursor.sh',
        headers: { 'x-anyrun-network-token': 'fixture-routing' },
        token: 'fixture-token',
    });
    const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update(clear), cipher.final()]).toString('base64');
    await Bun.write(
        path.join(appDir, 'gateway-descriptor.json'),
        JSON.stringify(
            scenario === 'success' && id === KIWI_ID
                ? { encrypted, version: 1 }
                : {
                      entries: {
                          active: { encrypted },
                          ...(scenario === 'ambiguous' ? { other: { encrypted } } : {}),
                      },
                      version: 2,
                  },
        ),
    );
};

describe('Grok Bot gateway deletion', () => {
    it.each([
        { error: '', id: KIWI_ID, name: 'delete a bot', scenario: 'success' },
        { error: '', id: BAMBA_ID, name: 'delete a group', scenario: 'success' },
        { error: '', id: KIWI_ID, name: 'ignore a matching name with a different ID', scenario: 'missing' },
        {
            error: 'deletion was not confirmed',
            id: KIWI_ID,
            name: 'report an unconfirmed deletion without retrying',
            scenario: 'failed',
        },
        { error: 'Unable to list bots/groups', id: KIWI_ID, name: 'stop when listing fails', scenario: 'list-failed' },
        {
            error: 'unrecognized gateway',
            id: KIWI_ID,
            name: 'reject an untrusted credential destination',
            scenario: 'untrusted',
        },
        { error: 'ambiguous or empty', id: KIWI_ID, name: 'reject ambiguous saved accounts', scenario: 'ambiguous' },
    ])('should $name without changing app persistence', async ({ id, scenario, error }) => {
        const appDir = await mkdtemp(path.join(os.tmpdir(), 'grok-gateway-delete-'));
        const root = path.join(appDir, 'sand-client-persistence');
        await fs.mkdir(root);
        const spawn = Bun.spawn;
        const processMock = spyOn(Bun, 'spawn').mockImplementation((command) => {
            const args = command as string[];
            expect(args).toEqual(['/usr/bin/security', 'find-generic-password', '-w', '-s', 'Grok Bot Safe Storage']);
            return spawn([process.execPath, '-e', 'process.stdout.write("fixture-secret")'], { stdout: 'pipe' });
        });
        const calls: Array<{ url: string; body: unknown }> = [];
        const gateway = spyOn(globalThis, 'fetch').mockImplementation(
            Object.assign(
                async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
                    const url = String(input);
                    calls.push({ body: JSON.parse(String(options?.body)), url });
                    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer fixture-token');
                    expect(new Headers(options?.headers).get('x-anyrun-network-token')).toBe('fixture-routing');
                    expect(options?.redirect).toBe('error');
                    if (scenario === 'list-failed' || (scenario === 'failed' && url.endsWith('/deleteAgent'))) {
                        throw new Error('fixture network failure');
                    }
                    const agents =
                        scenario === 'missing'
                            ? [{ id: 'different-id', name: id }]
                            : [KIWI_ROSTER_ROW, { id: BAMBA_ID, isGroup: true }];
                    return Response.json(url.endsWith('/listAgents') ? { agents } : {});
                },
                { preconnect: fetch.preconnect },
            ),
        );
        try {
            await writeFixture(root);
            await writeGatewaySession(appDir, scenario, id);
            const before = await Promise.all(
                (await readdir(root)).sort().map(async (name) => [name, await Bun.file(path.join(root, name)).text()]),
            );
            if (error) {
                await expect(deleteGrokBotConversation(root, id)).rejects.toThrow(error);
            } else {
                await expect(deleteGrokBotConversation(root, id)).resolves.toEqual({
                    deletedFiles: [],
                    deletedIds: scenario === 'missing' ? [] : [id],
                });
            }
            const expectedCalls = [
                { body: {}, url: 'https://fixture.cursor.sh/api/listAgents' },
                { body: { id }, url: 'https://fixture.cursor.sh/api/deleteAgent' },
            ];
            const count = ['untrusted', 'ambiguous'].includes(scenario)
                ? 0
                : ['missing', 'list-failed'].includes(scenario)
                  ? 1
                  : 2;
            expect(calls).toEqual(expectedCalls.slice(0, count));
            const after = await Promise.all(
                (await readdir(root)).sort().map(async (name) => [name, await Bun.file(path.join(root, name)).text()]),
            );
            expect(after).toEqual(before);
        } finally {
            gateway.mockRestore();
            processMock.mockRestore();
            await rm(appDir, { force: true, recursive: true });
        }
    });
});
