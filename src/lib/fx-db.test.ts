import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deleteFxSession, listFxSessionsForGroup, listFxWorkspaceGroups, readFxSessionTranscript } from './fx-db';
import { writeFxFixture } from './fx-test-helpers';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fx-db-test-'));
    tempRoots.push(root);
    return root;
};

describe('FX db helpers', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should list FX workspaces and sessions with transcript statistics', async () => {
        const fixture = await writeFxFixture(await makeTempRoot());

        const workspaces = await listFxWorkspaceGroups(fixture.dataDir);
        const sessions = await listFxSessionsForGroup(workspaces[0]!.key, fixture.dataDir);

        expect(workspaces).toEqual([
            expect.objectContaining({
                label: 'project',
                sessionCount: 1,
                toolCallCount: 1,
                worktree: fixture.workspacePath,
            }),
        ]);
        expect(sessions).toEqual([
            expect.objectContaining({
                currentModelId: 'anthropic/claude-sonnet-4.5',
                sessionId: fixture.sessionId,
                title: 'FX router migration',
                toolCallCount: 1,
            }),
        ]);
    });

    it('should reconstruct checkpoint, committed, and in-progress turns with full tool results', async () => {
        const fixture = await writeFxFixture(await makeTempRoot());

        const transcript = await readFxSessionTranscript(fixture.dataDir, fixture.sessionId);

        expect(
            transcript?.messages.filter((message) => message.role === 'user').map((message) => message.content),
        ).toEqual(['Prepare the baseline.', 'Inspect the committed turn.', 'Continue after the committed turn.']);
        expect(transcript?.messages.at(-1)).toMatchObject({
            content: 'The in-progress response is still useful.',
            finishReason: 'in_progress',
            role: 'assistant',
        });
        const toolCall = transcript?.messages.flatMap((message) => message.toolCalls)[0];
        expect(toolCall).toMatchObject({
            callId: 'call-pwd',
            command: 'pwd',
            status: 'succeeded',
            toolName: 'bash',
        });
        expect(toolCall?.outputText).toContain('full externalized output');
    });

    it('should omit raw payloads for bounded API hydration', async () => {
        const fixture = await writeFxFixture(await makeTempRoot());

        const transcript = await readFxSessionTranscript(fixture.dataDir, fixture.sessionId, {
            includeRawPayloads: false,
        });

        expect(transcript?.rawPayloadsOmitted).toBe(true);
        expect(transcript?.messages.every((message) => Object.keys(message.raw).length === 0)).toBe(true);
        expect(
            transcript?.messages
                .flatMap((message) => message.toolCalls)
                .every((toolCall) => Object.keys(toolCall.raw).length === 0),
        ).toBe(true);
    });

    it('should delete a session directory and its index and latest references', async () => {
        const fixture = await writeFxFixture(await makeTempRoot());

        const result = await deleteFxSession(fixture.dataDir, fixture.sessionId);

        expect(result.deletedSessionIds).toEqual([fixture.sessionId]);
        expect(await Bun.file(path.join(fixture.sessionDir, 'session.json')).exists()).toBe(false);
        expect((await Bun.file(path.join(fixture.sessionsDir, 'index.json')).json()).sessions).toEqual([]);
        expect(
            (await Bun.file(path.join(fixture.sessionsDir, 'relationship-migration-index.json')).json()).sessions,
        ).toEqual([]);
        expect(await Bun.file(path.join(fixture.sessionsDir, 'latest', 'workspace.json')).exists()).toBe(false);
    });

    it('should reject unsafe session ids without deleting data', async () => {
        const fixture = await writeFxFixture(await makeTempRoot());
        await Bun.write(path.join(fixture.dataDir, 'session.json'), '{}');

        await expect(deleteFxSession(fixture.dataDir, '../sessions')).resolves.toEqual({
            deletedFiles: [],
            deletedSessionIds: [],
        });
        await expect(deleteFxSession(fixture.dataDir, '..')).resolves.toEqual({
            deletedFiles: [],
            deletedSessionIds: [],
        });
        expect(await readFxSessionTranscript(fixture.dataDir, '..')).toBeNull();
        expect(await Bun.file(path.join(fixture.sessionDir, 'session.json')).exists()).toBe(true);
        expect(await Bun.file(path.join(fixture.dataDir, 'session.json')).exists()).toBe(true);
    });
});
