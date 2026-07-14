import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deleteConversation, listConversationsForPath, resolveConversationRef } from './index';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conversation-grok-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

const writeJson = async (filePath: string, value: unknown) => {
    await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeJsonl = async (filePath: string, values: unknown[]) => {
    await Bun.write(filePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
};

const writeGrokConversation = async (grokHome: string, workspacePath: string) => {
    const sessionId = '019f2e0a-a16c-7120-97da-8fae66e36731';
    const sessionDir = path.join(grokHome, 'sessions', encodeURIComponent(workspacePath), sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeJson(path.join(grokHome, 'models_cache.json'), {
        models: {
            'grok-composer-2.5-fast': {
                info: {
                    name: 'Composer 2.5',
                },
            },
        },
    });
    await writeJson(path.join(sessionDir, 'summary.json'), {
        agent_name: 'cursor',
        created_at: '2026-07-04T16:51:16.555Z',
        current_model_id: 'grok-composer-2.5-fast',
        generated_title: 'Review #109 #209',
        head_branch: 'next',
        info: {
            cwd: workspacePath,
            id: sessionId,
        },
        last_active_at: '2026-07-04T16:53:22.342Z',
        num_chat_messages: 5,
    });
    await writeJsonl(path.join(sessionDir, 'chat_history.jsonl'), [
        { content: 'system', type: 'system' },
        {
            content: [{ text: 'Review this implementation.', type: 'text' }],
            type: 'user',
        },
        {
            content: 'I am checking it.',
            model_id: 'grok-composer-2.5-fast',
            type: 'assistant',
        },
        {
            summary: [{ summary_text: 'Checking seed refresh behavior.' }],
            type: 'reasoning',
        },
        {
            content: 'Failed refresh leaves a mutated candidate tree with stale artifacts.',
            model_fingerprint: 'fp_123',
            model_id: 'grok-composer-2.5-fast',
            type: 'assistant',
        },
    ]);
    return { sessionId, sessionsDir: path.join(grokHome, 'sessions') };
};

describe('grok conversation adapter', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should list Grok conversations for a cwd with selected final answers', async () => {
        const grokHome = await makeTempRoot();
        const workspacePath = path.join(grokHome, 'repo');
        const fixture = await writeGrokConversation(grokHome, workspacePath);

        const page = await listConversationsForPath({
            cwd: workspacePath,
            includeMessages: true,
            locations: { grokSessionsDir: fixture.sessionsDir },
            messageSelector: 'last_final_answer',
            sources: ['grok'],
        });

        expect(page.data).toHaveLength(1);
        expect(page.data[0]).toMatchObject({
            id: fixture.sessionId,
            metadata: {
                currentModelId: 'grok-composer-2.5-fast',
                modelLabel: 'Composer 2.5',
            },
            source: 'grok',
            title: 'Review #109 #209',
            workspacePath,
        });
        expect(page.data[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'final_answer',
                role: 'assistant',
                text: 'Failed refresh leaves a mutated candidate tree with stale artifacts.',
            }),
        ]);
    });

    it('should assign unique monotonic message order values', async () => {
        const grokHome = await makeTempRoot();
        const workspacePath = path.join(grokHome, 'repo');
        const fixture = await writeGrokConversation(grokHome, workspacePath);

        const page = await listConversationsForPath({
            cwd: workspacePath,
            includeMessages: true,
            locations: { grokSessionsDir: fixture.sessionsDir },
            messageSelector: 'all',
            sources: ['grok'],
        });
        const orders = page.data[0]?.messages.map((message) => message.order) ?? [];

        expect(orders).toEqual(orders.map((_, index) => index));
        expect(new Set(orders).size).toBe(orders.length);
    });

    it('should resolve and delete Grok conversations through the stable facade', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokConversation(grokHome, path.join(grokHome, 'repo'));

        await expect(
            resolveConversationRef(`http://localhost:3000/grok-sessions/${fixture.sessionId}`),
        ).resolves.toEqual({
            id: fixture.sessionId,
            source: 'grok',
        });

        await expect(
            deleteConversation({
                id: fixture.sessionId,
                locations: { grokSessionsDir: fixture.sessionsDir },
                source: 'grok',
            }),
        ).resolves.toEqual({
            deletedFiles: expect.arrayContaining([
                path.join(
                    fixture.sessionsDir,
                    encodeURIComponent(path.join(grokHome, 'repo')),
                    fixture.sessionId,
                    'chat_history.jsonl',
                ),
            ]),
            deletedIds: [fixture.sessionId],
        });
    });
});
