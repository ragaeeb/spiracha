import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandCodeConversationAdapter } from './command-code-adapter';

const tempRoots: string[] = [];

const writeFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'command-code-adapter-test-'));
    tempRoots.push(root);
    const projectDirectory = path.join(root, 'users-rhaq-workspace-harfbench');
    await mkdir(projectDirectory, { recursive: true });
    const sessionId = 'adapter-session';
    const records = [
        {
            cwd: '/workspace/harfbench',
            id: sessionId,
            timestamp: '2026-09-14T10:00:00Z',
            type: 'session',
            version: 3,
        },
        {
            id: 'user-1',
            message: {
                content: [{ text: 'Review the workspace', type: 'text' }],
                meta: { source: 'user' },
                role: 'user',
            },
            parentId: null,
            timestamp: '2026-09-14T10:00:01Z',
            type: 'message',
        },
        {
            id: 'assistant-1',
            message: {
                content: [{ text: 'I am checking the workspace.', type: 'text' }],
                meta: { source: 'model' },
                role: 'assistant',
            },
            model: 'z-ai/glm-5.3-flash',
            parentId: 'user-1',
            timestamp: '2026-09-14T10:00:02Z',
            type: 'message',
        },
        {
            id: 'assistant-2',
            message: {
                content: [{ text: 'rendering, size caps on both import paths', type: 'text' }],
                meta: { source: 'model' },
                role: 'assistant',
            },
            model: 'z-ai/glm-5.3-flash',
            parentId: 'assistant-1',
            timestamp: '2026-09-14T10:00:03Z',
            type: 'message',
        },
    ];
    const filePath = path.join(projectDirectory, `${sessionId}.jsonl`);
    const raw = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
    await Bun.write(filePath, raw);
    return { filePath, raw, root, sessionId };
};

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('Command Code conversation adapter', () => {
    it('should apply path matching and message selectors through the stable adapter contract', async () => {
        const { root, sessionId } = await writeFixture();
        const page = await commandCodeConversationAdapter.listConversations({
            cwd: '/workspace',
            includeMessages: true,
            locations: { commandCodeProjectsDir: root },
            messageSelector: 'last_final_answer',
            sources: ['command-code'],
        });

        expect(page).toHaveLength(1);
        expect(page[0]).toMatchObject({
            model: 'z-ai/glm-5.3-flash',
            source: 'command-code',
            title: 'Review the workspace',
            workspacePath: '/workspace/harfbench',
        });
        expect(page[0]?.matches).toEqual([
            {
                candidatePath: '/workspace/harfbench',
                kind: 'descendant',
                requestedPath: '/workspace',
            },
        ]);
        expect(page[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'final_answer',
                text: 'rendering, size caps on both import paths',
            }),
        ]);

        const metadataPage = await commandCodeConversationAdapter.listConversations({
            cwd: '/workspace/harfbench',
            includeMessages: false,
            locations: { commandCodeProjectsDir: root },
            sources: ['command-code'],
        });
        expect(metadataPage[0]?.messages).toEqual([]);

        const detail = await commandCodeConversationAdapter.getConversation({
            id: sessionId,
            locations: { commandCodeProjectsDir: root },
            messageSelector: 'all',
            source: 'command-code',
        });
        expect(detail?.messages).toHaveLength(3);
        expect(detail?.deepLinks).toEqual({
            native: null,
            spiracha: `spiracha://conversation/command-code/${sessionId}`,
            ui: `/command-code-sessions/${sessionId}`,
        });
    });

    it('should return the selected original JSONL bytes and no delete operation', async () => {
        const { filePath, raw, root, sessionId } = await writeFixture();
        const download = await commandCodeConversationAdapter.getConversationRaw?.({
            id: sessionId,
            locations: { commandCodeProjectsDir: root },
            source: 'command-code',
        });

        expect(download).toMatchObject({
            fileName: path.basename(filePath),
            mimeType: 'application/x-ndjson',
        });
        expect(await download?.blob.text()).toBe(raw);
        expect(commandCodeConversationAdapter.deleteConversation).toBeUndefined();
    });
});
