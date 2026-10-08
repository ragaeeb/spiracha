import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOpenCodeFixture } from '../opencode-test-helpers';
import { buildNormalizedConversationJson } from './normalized-json-export';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const createDb = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'normalized-json-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'opencode.db');
    await createOpenCodeFixture(dbPath, {
        projects: [{ id: 'pro_demo', name: null, timeUpdated: 1_700_000_000_000, worktree: '/work/demo' }],
        sessions: [
            {
                id: 'ses_main',
                messages: [
                    {
                        id: 'msg_user',
                        parts: [{ data: { text: 'Hello there', type: 'text' }, id: 'prt_text' }],
                        role: 'user',
                        timeCreated: 1_700_000_000_100,
                    },
                ],
                projectId: 'pro_demo',
                timeCreated: 1_700_000_000_000,
                timeUpdated: 1_700_000_100_000,
                title: 'Demo',
            },
        ],
    });
    return dbPath;
};

describe('buildNormalizedConversationJson', () => {
    it('should wrap the normalized conversation together with the complete OpenCode table rows', async () => {
        const dbPath = await createDb();

        const json = await buildNormalizedConversationJson({
            id: 'ses_main',
            locations: { opencodeDbPath: dbPath },
            source: 'opencode',
        });
        const parsed = JSON.parse(json ?? 'null');

        expect(parsed).toMatchObject({
            conversation: { id: 'ses_main', source: 'opencode', title: 'Demo' },
            format: 'spiracha/normalized-conversation',
            formatVersion: 1,
            source: 'opencode',
        });
        expect(parsed.conversation.messages.length).toBeGreaterThan(0);
        expect(parsed.sourceTables.session).toMatchObject({
            time_created: 1_700_000_000_000,
            time_updated: 1_700_000_100_000,
        });
        expect(parsed.sourceTables.message[0]).toMatchObject({ id: 'msg_user', time_created: 1_700_000_000_100 });
        expect(parsed.sourceTables.part[0]).toMatchObject({
            data: { text: 'Hello there', type: 'text' },
            id: 'prt_text',
        });
    });

    it('should return null when the conversation does not exist', async () => {
        const dbPath = await createDb();

        await expect(
            buildNormalizedConversationJson({
                id: 'ses_none',
                locations: { opencodeDbPath: dbPath },
                source: 'opencode',
            }),
        ).resolves.toBeNull();
    });
});
