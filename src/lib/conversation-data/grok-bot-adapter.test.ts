import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getGrokBotPersistenceFilePath } from '../grok-bot-db';
import { grokBotConversationAdapter } from './grok-bot-adapter';

const SLOT = 'google-oauth2|user/test';
const KIWI_ID = 'bd5bbf01-a4e1-47f8-885f-f2188cf04aab';
const BAMBA_ID = '477a1920-782e-4470-944f-b808c21f0fde';

const writeBlob = async (root: string, key: string, value: unknown, schemaVersion = 1) => {
    await Bun.write(getGrokBotPersistenceFilePath(root, key), JSON.stringify({ schemaVersion, value }));
};

const createFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'grok-bot-adapter-'));
    const accountPrefix = `sand.client.slice.account.${encodeURIComponent(SLOT)}`;
    await writeBlob(root, 'sand.client.slice.client-meta.account-slot', SLOT);
    await writeBlob(
        root,
        `${accountPrefix}.roster.last-roster`,
        {
            rows: [
                { id: KIWI_ID, isGroup: false, name: 'Kiwi', title: 'Developer' },
                { id: BAMBA_ID, isGroup: true, memberIds: [KIWI_ID, 'safiyyah'], name: 'Bamba Dev Team' },
                { id: 'safiyyah', isGroup: false, name: 'Safiyyah' },
            ],
        },
        4,
    );
    await writeBlob(root, `${accountPrefix}.transcript.replicas.${KIWI_ID}`, {
        entries: [
            {
                content: 'What about reasoning level for each?',
                id: 'kiwi-user',
                kind: 'message',
                role: 'user',
                timestampMs: 10,
            },
            {
                author: { id: 'kiwi', name: 'Kiwi' },
                id: 'kiwi-agent',
                kind: 'send-message',
                message: { content: 'each agent’s profile/settings stores reasoning level', type: 'text' },
                timestampMs: 11,
            },
            {
                event: 'automation-changed',
                id: 'kiwi-event',
                kind: 'event',
                timestampMs: 12,
            },
        ],
    });
    await writeBlob(root, `${accountPrefix}.transcript.replicas.${BAMBA_ID}`, {
        entries: [
            {
                content: 'footer showing up in prod',
                id: 'bamba-user',
                kind: 'message',
                role: 'user',
                timestampMs: 20,
            },
            {
                author: { id: 'kiwi', name: 'Kiwi' },
                id: 'bamba-kiwi',
                kind: 'send-message',
                message: { content: 'Terms, and Privacy are live in prod', type: 'text' },
                timestampMs: 21,
            },
            {
                author: { id: 'safiyyah', name: 'Safiyyah' },
                id: 'bamba-safiyyah',
                kind: 'send-message',
                message: { content: 'Standing by — @User merging to `main`. No push from me.', type: 'text' },
                timestampMs: 22,
            },
            {
                file_name: 'screen.png',
                file_path: '/private/should-not-leak.png',
                id: 'bamba-attachment',
                kind: 'user-attachment',
                timestampMs: 23,
            },
        ],
    });
    return { accountPrefix, root };
};

describe('grok bot conversation adapter', () => {
    it('should normalize direct and group chats without inventing model or workspace data', async () => {
        const { root } = await createFixture();
        try {
            const kiwi = await grokBotConversationAdapter.getConversation({
                id: KIWI_ID,
                locations: { grokBotPersistenceDir: root },
                messageSelector: 'all',
                source: 'grok-bot',
            });
            const bamba = await grokBotConversationAdapter.getConversation({
                id: BAMBA_ID,
                locations: { grokBotPersistenceDir: root },
                messageSelector: 'all',
                source: 'grok-bot',
            });

            expect(kiwi).toMatchObject({
                deepLinks: {
                    native: null,
                    ui: `/grok-bot-chats/${KIWI_ID}`,
                },
                source: 'grok-bot',
                title: 'Kiwi',
                workspaceKey: null,
                workspacePath: null,
            });
            expect(kiwi?.model).toBeUndefined();
            expect(kiwi?.messages.map(({ role, text }) => ({ role, text }))).toEqual([
                { role: 'user', text: 'What about reasoning level for each?' },
                { role: 'assistant', text: 'each agent’s profile/settings stores reasoning level' },
            ]);
            expect(bamba?.messages.map(({ role, text }) => ({ role, text }))).toEqual([
                { role: 'user', text: 'footer showing up in prod' },
                { role: 'assistant', text: 'Terms, and Privacy are live in prod' },
                { role: 'assistant', text: 'Standing by — @User merging to `main`. No push from me.' },
            ]);
            expect(bamba?.messages[1]?.metadata).toMatchObject({ authorId: 'kiwi', authorName: 'Kiwi' });
            expect(bamba?.metadata).toMatchObject({
                chatKind: 'group',
                memberIds: [KIWI_ID, 'safiyyah'],
                members: [
                    { id: KIWI_ID, name: 'Kiwi' },
                    { id: 'safiyyah', name: 'Safiyyah' },
                ],
            });
            expect(JSON.stringify(bamba)).not.toContain('/private/should-not-leak.png');
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('should keep list reads bounded, expose exact raw bytes, and support delete', async () => {
        const { root, accountPrefix } = await createFixture();
        try {
            await Bun.write(
                getGrokBotPersistenceFilePath(root, `${accountPrefix}.transcript.replicas.safiyyah`),
                '{not parsed by list}',
            );
            const summaries = await grokBotConversationAdapter.listConversations({
                includeMessages: true,
                locations: { grokBotPersistenceDir: root },
                sources: ['grok-bot'],
            });
            expect(summaries).toHaveLength(3);
            expect(summaries.every((summary) => summary.messageCount === null && summary.messages.length === 0)).toBe(
                true,
            );

            const rawPath = getGrokBotPersistenceFilePath(root, `${accountPrefix}.transcript.replicas.${BAMBA_ID}`);
            const raw = await grokBotConversationAdapter.getConversationRaw!({
                id: BAMBA_ID,
                locations: { grokBotPersistenceDir: root },
                source: 'grok-bot',
            });
            expect(raw?.fileName).toBe(path.basename(rawPath));
            expect(await raw?.blob.text()).toBe(await Bun.file(rawPath).text());
            expect(grokBotConversationAdapter.deleteConversation).toBeDefined();
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
