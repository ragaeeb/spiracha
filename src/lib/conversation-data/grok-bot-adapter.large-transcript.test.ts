import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getGrokBotPersistenceFilePath } from '../grok-bot-db';
import { grokBotConversationAdapter } from './grok-bot-adapter';

const writeBlob = (root: string, key: string, value: unknown, schemaVersion = 1) =>
    Bun.write(getGrokBotPersistenceFilePath(root, key), JSON.stringify({ schemaVersion, value }));

describe('large native Grok Bot transcripts', () => {
    it('should load a transcript below the persistence byte limit without argument-limit failures', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-large-grok-bot-'));
        const count = 150_000;
        const account = 'audit-account';
        const prefix = `sand.client.slice.account.${encodeURIComponent(account)}`;
        try {
            await writeBlob(root, 'sand.client.slice.client-meta.account-slot', account);
            await writeBlob(
                root,
                `${prefix}.roster.last-roster`,
                { rows: [{ id: 'large', isGroup: false, name: 'Large conversation' }] },
                4,
            );
            const transcript = {
                entries: Array.from({ length: count }, (_, index) => ({
                    content: 'x',
                    kind: 'message',
                    role: 'user',
                    timestampMs: index,
                })),
            };
            expect(new TextEncoder().encode(JSON.stringify(transcript)).byteLength).toBeLessThanOrEqual(
                16 * 1024 * 1024,
            );
            await writeBlob(root, `${prefix}.transcript.replicas.large`, transcript);
            const conversation = await grokBotConversationAdapter.getConversation({
                id: 'large',
                locations: { grokBotPersistenceDir: root },
                messageSelector: 'all',
                source: 'grok-bot',
            });
            expect(conversation?.updatedAtMs).toBe(count - 1);
            expect(conversation?.messages).toHaveLength(count);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
