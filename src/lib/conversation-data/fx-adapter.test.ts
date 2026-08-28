import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeFxFixture } from '../fx-test-helpers';
import { deleteConversation, getConversation, listConversationsForPath, resolveConversationRef } from './index';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'conversation-fx-test-'));
    tempRoots.push(root);
    return root;
};

describe('FX conversation adapter', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should list path-scoped FX conversations with the selected final answer', async () => {
        const fixture = await writeFxFixture(await makeTempRoot());

        const page = await listConversationsForPath({
            cwd: fixture.workspacePath,
            includeMessages: true,
            locations: { fxDataDir: fixture.dataDir },
            messageSelector: 'last_final_answer',
            sources: ['fx'],
        });

        expect(page.data).toEqual([
            expect.objectContaining({
                id: fixture.sessionId,
                model: 'anthropic/claude-sonnet-4.5',
                source: 'fx',
                title: 'FX router migration',
                workspacePath: fixture.workspacePath,
            }),
        ]);
        expect(page.data[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'final_answer',
                role: 'assistant',
                text: 'The committed turn is complete.',
            }),
        ]);
    });

    it('should expose commentary and paired tool evidence with monotonic order', async () => {
        const fixture = await writeFxFixture(await makeTempRoot());

        const conversation = await getConversation({
            id: fixture.sessionId,
            locations: { fxDataDir: fixture.dataDir },
            messageSelector: 'all',
            source: 'fx',
        });
        const messages = conversation?.messages ?? [];

        expect(messages.map((message) => message.order)).toEqual(messages.map((_, index) => index));
        expect(messages.find((message) => message.phase === 'commentary')?.text).toBe('I will inspect the workspace.');
        expect(messages.find((message) => message.phase === 'tool_call')?.toolEvidence).toMatchObject({
            callId: 'call-pwd',
            command: 'pwd',
            name: 'bash',
            status: 'succeeded',
            workdir: fixture.workspacePath,
        });
        expect(messages.find((message) => message.phase === 'tool_output')?.toolEvidence?.outputText).toContain(
            'full externalized output',
        );
    });

    it('should resolve FX session URLs', async () => {
        await expect(resolveConversationRef('http://localhost:3000/fx-sessions/session-123')).resolves.toEqual({
            id: 'session-123',
            source: 'fx',
        });
    });

    it('should delete FX sessions through the stable facade', async () => {
        const fixture = await writeFxFixture(await makeTempRoot());

        const result = await deleteConversation({
            id: fixture.sessionId,
            locations: { fxDataDir: fixture.dataDir },
            source: 'fx',
        });

        expect(result?.deletedIds).toEqual([fixture.sessionId]);
        expect(await Bun.file(path.join(fixture.sessionDir, 'session.json')).exists()).toBe(false);
    });
});
