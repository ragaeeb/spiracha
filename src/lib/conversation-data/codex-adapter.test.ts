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

const appendTranscriptRecord = async (filePath: string, record: unknown) => {
    const current = await Bun.file(filePath).text();
    await Bun.write(filePath, `${current.trimEnd()}\n${JSON.stringify(record)}\n`);
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

        const completeDetail = await getConversation({
            id: fixture.threads[0]!.threadId,
            locations: { codexDbPath: fixture.dbPath },
            messageSelector: 'all',
            source: 'codex',
        });
        expect(completeDetail?.messages.find((message) => message.phase === 'tool_call')?.toolEvidence).toMatchObject({
            callId: expect.any(String),
            name: expect.any(String),
        });
    });

    it('should keep Codex conversations available when one rollout file disappears', async () => {
        const fixture = await createCodexBrowserFixture(await makeTempRoot());
        const missingThread = fixture.threads[0]!;
        await rm(missingThread.sessionFile);

        const page = await listConversationsForPath({
            cwd: missingThread.cwd,
            includeMessages: true,
            locations: { codexDbPath: fixture.dbPath },
            messageSelector: 'all',
            sources: ['codex'],
        });

        expect(page.data).toHaveLength(2);
        expect(page.data.find((conversation) => conversation.id === missingThread.threadId)?.messages).toEqual([]);
        expect(page.data.some((conversation) => conversation.messages.length > 0)).toBe(true);
    });

    it('should omit centralized hidden Codex bootstrap messages from normalized conversations', async () => {
        const fixture = await createCodexBrowserFixture(await makeTempRoot());
        const thread = fixture.threads[0]!;
        await appendTranscriptRecord(thread.sessionFile, {
            payload: {
                message: '<environment_context>private bootstrap context</environment_context>',
                type: 'user_message',
            },
            timestamp: '2026-07-17T12:00:00.000Z',
            type: 'response_item',
        });

        const detail = await getConversation({
            id: thread.threadId,
            locations: { codexDbPath: fixture.dbPath },
            messageSelector: 'all',
            source: 'codex',
        });

        expect(detail?.messages.some((message) => message.text.includes('private bootstrap context'))).toBe(false);
        expect(detail?.messages.some((message) => message.role === 'user')).toBe(true);
    });

    it('should normalize invalid timestamps, unknown phases, and sparse event sequences', async () => {
        const fixture = await createCodexBrowserFixture(await makeTempRoot());
        const thread = fixture.threads[0]!;
        await appendTranscriptRecord(thread.sessionFile, {
            payload: {
                content: [{ text: 'Legacy assistant update.', type: 'output_text' }],
                phase: 'legacy_progress',
                role: 'assistant',
                type: 'message',
            },
            timestamp: 'not-a-timestamp',
            type: 'response_item',
        });
        await appendTranscriptRecord(thread.sessionFile, {
            payload: {
                content: [{ text: 'Tool-authored message.', type: 'output_text' }],
                role: 'tool',
                type: 'message',
            },
            timestamp: '2026-07-17T12:00:00.000Z',
            type: 'response_item',
        });

        const detail = await getConversation({
            id: thread.threadId,
            locations: { codexDbPath: fixture.dbPath },
            messageSelector: 'all',
            source: 'codex',
        });
        const legacyMessage = detail?.messages.find((message) => message.text === 'Legacy assistant update.');
        const toolMessage = detail?.messages.find((message) => message.text === 'Tool-authored message.');

        expect(legacyMessage).toMatchObject({
            createdAtMs: null,
            phase: 'unknown',
        });
        expect(toolMessage).toMatchObject({ role: 'tool' });
        expect(detail?.messages.map((message) => message.order)).toEqual(detail?.messages.map((_, index) => index));
    });

    it('should omit empty Codex tool outputs from normalized messages', async () => {
        const fixture = await createCodexBrowserFixture(await makeTempRoot());
        const thread = fixture.threads[0]!;
        await appendTranscriptRecord(thread.sessionFile, {
            payload: { call_id: 'empty-output', output: '', type: 'function_call_output' },
            timestamp: '2026-07-17T12:00:00.000Z',
            type: 'response_item',
        });

        const detail = await getConversation({
            id: thread.threadId,
            locations: { codexDbPath: fixture.dbPath },
            messageSelector: 'all',
            source: 'codex',
        });

        expect(detail?.messages.some((message) => message.text === '')).toBe(false);
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
        await expect(
            resolveConversationRef('http://localhost:3000/api/v1/conversations/codex/thread%2Fencoded/export'),
        ).resolves.toEqual({
            id: 'thread/encoded',
            source: 'codex',
        });
        await expect(
            resolveConversationRef(
                'http://localhost:3000/app/qoder-sessions/task-b353034281d1417eb2e3.session.execution',
            ),
        ).resolves.toEqual({
            id: 'task-b353034281d1417eb2e3.session.execution',
            source: 'qoder',
        });
        await expect(resolveConversationRef('spiracha://conversation/qoder/task%2Fencoded')).resolves.toEqual({
            id: 'task/encoded',
            source: 'qoder',
        });
        await expect(resolveConversationRef('spiracha://conversation/qoder/id/extra')).resolves.toBeNull();
    });
});
