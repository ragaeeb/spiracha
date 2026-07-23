import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCursorFixture } from '../cursor-test-helpers';
import { cursorConversationAdapter, deleteCursorConversation } from './cursor-adapter';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('cursorConversationAdapter', () => {
    it('should refuse custom-directory deletes while Cursor is running', async () => {
        await expect(
            deleteCursorConversation(
                {
                    id: 'thread-1',
                    locations: { cursorUserDir: '/tmp/custom-cursor-user-dir' },
                    source: 'cursor',
                },
                async () => true,
            ),
        ).rejects.toThrow('Quit Cursor before deleting');
    });

    it('should classify intermediate assistant progress as commentary', async () => {
        const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-adapter-'));
        tempDirs.push(userDir);
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'bucket-1',
                    composerIds: ['thread-1'],
                    folder: 'file:///repo',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [{ bucketId: 'bucket-1', composerId: 'thread-1', uriPath: '/repo' }],
            threads: [
                {
                    bubbles: [
                        { bubbleId: 'u1', text: 'Fix the export', type: 1 },
                        {
                            bubbleId: 'a1',
                            text: 'I will inspect the component first.',
                            toolCall: { name: 'read_file', result: 'source' },
                            type: 2,
                        },
                        {
                            bubbleId: 'a2',
                            text: 'Fixed the dialog styling and export behavior.',
                            type: 2,
                        },
                    ],
                    composerId: 'thread-1',
                    name: 'Export fix',
                },
            ],
        });

        const conversation = await cursorConversationAdapter.getConversation({
            id: 'thread-1',
            locations: { cursorUserDir: userDir },
            messageSelector: 'all',
            source: 'cursor',
        });

        expect(
            conversation?.messages
                .filter((message) => message.role === 'assistant')
                .map(({ phase, text }) => ({ phase, text })),
        ).toEqual([
            { phase: 'commentary', text: 'I will inspect the component first.' },
            { phase: 'final_answer', text: 'Fixed the dialog styling and export behavior.' },
        ]);
        expect(
            conversation?.messages
                .filter((message) => message.role === 'tool')
                .map(({ phase, text }) => ({ phase, text })),
        ).toEqual([
            { phase: 'tool_call', text: 'read_file\n{}' },
            { phase: 'tool_output', text: 'source' },
        ]);
        expect(conversation?.metadata).not.toHaveProperty('transcriptDirs');
        expect(conversation?.messages.find((message) => message.phase === 'tool_call')?.toolEvidence).toMatchObject({
            name: 'read_file',
        });
    });

    it('should list path-scoped Cursor conversations within an updated-time window', async () => {
        const userDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-adapter-list-'));
        tempDirs.push(userDir);
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'bucket-1',
                    composerIds: ['thread-in-window'],
                    folder: 'file:///repo',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [{ bucketId: 'bucket-1', composerId: 'thread-in-window', uriPath: '/repo' }],
            threads: [
                {
                    bubbles: [{ bubbleId: 'u1', text: 'Scoped thread', type: 1 }],
                    composerId: 'thread-in-window',
                    lastUpdatedAt: 200,
                    name: 'Scoped Cursor thread',
                },
            ],
        });

        const conversations = await cursorConversationAdapter.listConversationsForPath({
            cwd: '/repo',
            includeMessages: false,
            locations: { cursorUserDir: userDir },
            updatedAfterMs: 100,
            updatedBeforeMs: 300,
        });
        const excluded = await cursorConversationAdapter.listConversationsForPath({
            cwd: '/repo',
            locations: { cursorUserDir: userDir },
            updatedBeforeMs: 100,
        });

        expect(conversations.map(({ id }) => id)).toEqual(['thread-in-window']);
        expect(conversations[0]?.matches[0]?.kind).toBe('exact');
        expect(conversations[0]?.messages).toEqual([]);
        expect(excluded).toEqual([]);
    });
});
