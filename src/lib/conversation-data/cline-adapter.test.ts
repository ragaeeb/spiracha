import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CLINE_SESSION_ID, writeClineSessionFixture } from '../cline-test-helpers';
import { deleteConversation, listConversationsForPath, resolveConversationRef } from './index';

const tempRoots: string[] = [];

describe('Cline conversation adapter', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should list Cline chats for a cwd with the selected final answer', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'conversation-cline-test-'));
        tempRoots.push(root);
        const workspacePath = path.join(root, 'repo');
        const dataDir = path.join(root, 'cline-data');
        await writeClineSessionFixture({ dataDir, workspacePath });

        const page = await listConversationsForPath({
            cwd: workspacePath,
            includeMessages: true,
            locations: { clineDataDir: dataDir },
            messageSelector: 'last_final_answer',
            sources: ['cline'],
        });

        expect(page.data).toHaveLength(1);
        expect(page.data[0]).toMatchObject({
            id: CLINE_SESSION_ID,
            metadata: { isFavorited: true, modelId: 'deepseek/deepseek-v4-flash' },
            source: 'cline',
            title: 'Fix issue 1494 per the implementation plan',
            workspacePath,
        });
        expect(page.data[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'final_answer',
                role: 'assistant',
                text: 'Implemented Fix issue 1494 per the implementation plan.',
            }),
        ]);
    });

    it('should resolve Cline task URLs and delete chats through the stable facade', async () => {
        await expect(resolveConversationRef(`http://localhost:3000/cline-tasks/${CLINE_SESSION_ID}`)).resolves.toEqual({
            id: CLINE_SESSION_ID,
            source: 'cline',
        });

        const root = await mkdtemp(path.join(os.tmpdir(), 'conversation-cline-delete-test-'));
        tempRoots.push(root);
        const dataDir = path.join(root, 'cline-data');
        await writeClineSessionFixture({ dataDir, workspacePath: path.join(root, 'repo') });
        await expect(
            deleteConversation({
                id: CLINE_SESSION_ID,
                locations: { clineDataDir: dataDir },
                source: 'cline',
            }),
        ).resolves.toMatchObject({ deletedIds: [CLINE_SESSION_ID] });
    });
});
