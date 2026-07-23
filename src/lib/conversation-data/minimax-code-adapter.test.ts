import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeMiniMaxCodeSessionFixture } from '../minimax-code-test-helpers';
import { listConversationsForPath, resolveConversationRef } from './index';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conversation-minimax-code-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

describe('MiniMax Code conversation adapter', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should list MiniMax Code conversations for a cwd with the selected final answer', async () => {
        const tempRoot = await makeTempRoot();
        const workspacePath = path.join(tempRoot, 'repo');
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const fixture = await writeMiniMaxCodeSessionFixture({ sessionsDir, workspacePath });

        const page = await listConversationsForPath({
            cwd: workspacePath,
            includeMessages: true,
            locations: { minimaxCodeSessionsDir: sessionsDir },
            messageSelector: 'last_final_answer',
            sources: ['minimax-code'],
        });

        expect(page.data).toHaveLength(1);
        expect(page.data[0]).toMatchObject({
            id: fixture.sessionId,
            metadata: {
                agentName: 'main',
                currentModelId: 'minimax/MiniMax-M3',
                currentModelVariant: 'thinking',
            },
            source: 'minimax-code',
            title: 'Refactor evidence extraction module',
            workspacePath,
        });
        expect(page.data[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'final_answer',
                role: 'assistant',
                text: 'The detailed decomposition plan is ready.',
            }),
        ]);
    });

    it('should preserve reasoning and paired tool evidence with monotonic message order', async () => {
        const tempRoot = await makeTempRoot();
        const workspacePath = path.join(tempRoot, 'repo');
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        await writeMiniMaxCodeSessionFixture({ sessionsDir, workspacePath });

        const page = await listConversationsForPath({
            cwd: workspacePath,
            includeMessages: true,
            locations: { minimaxCodeSessionsDir: sessionsDir },
            messageSelector: 'all',
            sources: ['minimax-code'],
        });
        const messages = page.data[0]?.messages ?? [];

        expect(messages.map((message) => message.order)).toEqual(messages.map((_, index) => index));
        expect(messages.find((message) => message.phase === 'reasoning')?.text).toContain('complete picture');
        expect(messages.find((message) => message.phase === 'tool_call')?.toolEvidence).toMatchObject({
            callId: 'call-success',
            command: 'grep -rn "evidence-extraction" /Users/rhaq/workspace/ushman/CHANGELOG.md',
            name: 'bash',
            status: 'succeeded',
            workdir: workspacePath,
        });
        expect(messages.find((message) => message.phase === 'tool_output')?.toolEvidence).toMatchObject({
            callId: 'call-success',
            outputText: 'CHANGELOG.md:42:evidence-extraction',
        });
        expect(messages.filter((message) => message.phase === 'tool_call')[1]?.toolEvidence?.status).toBe('failed');
    });

    it('should resolve MiniMax Code session URLs', async () => {
        await expect(
            resolveConversationRef('http://localhost:3000/minimax-code-sessions/mvs_08a9fc9128b443a7b5cc92bc690ca37b'),
        ).resolves.toEqual({
            id: 'mvs_08a9fc9128b443a7b5cc92bc690ca37b',
            source: 'minimax-code',
        });
    });
});
