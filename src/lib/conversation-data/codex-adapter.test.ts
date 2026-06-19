import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexBrowserFixture } from '../codex-test-helpers';
import { getConversation, listConversationsForPath, resolveConversationRef } from './index';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conversation-codex-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

describe('codex conversation adapter', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should list matching Codex conversations for a cwd with selected final answers', async () => {
        const fixture = await createCodexBrowserFixture(await makeTempRoot());
        const page = await listConversationsForPath({
            cwd: fixture.threads[0]!.cwd,
            includeMessages: true,
            locations: { codexDbPath: fixture.dbPath },
            messageSelector: 'last_final_answer',
            sources: ['codex'],
        });

        expect(page.data).toHaveLength(2);
        expect(page.meta).toEqual({ hasNext: false, nextCursor: null });
        expect(page.data[0]).toMatchObject({
            id: fixture.threads[0]!.threadId,
            source: 'codex',
            workspacePath: fixture.threads[0]!.cwd,
        });
        expect(page.data[0]!.messages).toHaveLength(1);
        expect(page.data[0]!.messages[0]).toMatchObject({
            phase: 'final_answer',
            role: 'assistant',
        });
        expect(page.data[0]!.messages[0]!.text).toContain('Implemented');
    });

    it('should read a Codex conversation detail by id', async () => {
        const fixture = await createCodexBrowserFixture(await makeTempRoot());
        const detail = await getConversation({
            id: fixture.threads[0]!.threadId,
            locations: { codexDbPath: fixture.dbPath },
            messageSelector: 'last_final_answer',
            source: 'codex',
        });

        expect(detail).toMatchObject({
            id: fixture.threads[0]!.threadId,
            source: 'codex',
            title: fixture.threads[0]!.title,
        });
        expect(detail?.messages).toHaveLength(1);
        expect(detail?.deepLinks.spiracha).toBe(`spiracha://conversation/codex/${fixture.threads[0]!.threadId}`);
    });

    it('should resolve Codex UI and native thread references', async () => {
        await expect(resolveConversationRef('codex://threads/019ecbfc-8a84-7421-ab3b-35653feb7896')).resolves.toEqual({
            id: '019ecbfc-8a84-7421-ab3b-35653feb7896',
            source: 'codex',
        });
        await expect(
            resolveConversationRef('http://localhost:3000/threads/019ecbfc-8a84-7421-ab3b-35653feb7896'),
        ).resolves.toEqual({
            id: '019ecbfc-8a84-7421-ab3b-35653feb7896',
            source: 'codex',
        });
    });
});
