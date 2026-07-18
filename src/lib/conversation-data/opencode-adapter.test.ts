import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOpenCodeFixture } from '../opencode-test-helpers';
import { opencodeConversationAdapter } from './opencode-adapter';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('opencodeConversationAdapter', () => {
    it('should preserve think-tag literals in user messages', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-adapter-'));
        tempDirs.push(tempDir);
        const dbPath = path.join(tempDir, 'opencode.db');
        await createOpenCodeFixture(dbPath, {
            projects: [{ id: 'project-1', worktree: '/repo' }],
            sessions: [
                {
                    id: 'session-1',
                    messages: [
                        {
                            id: 'message-user',
                            parts: [
                                {
                                    data: { text: '<think>literal user input</think>', type: 'text' },
                                    id: 'part-user',
                                },
                            ],
                            role: 'user',
                        },
                        {
                            id: 'message-assistant',
                            parts: [
                                {
                                    data: {
                                        callID: 'call-1',
                                        state: {
                                            input: { path: 'src/index.ts' },
                                            output: 'file contents',
                                            status: 'completed',
                                        },
                                        tool: 'read',
                                        type: 'tool',
                                    },
                                    id: 'part-tool',
                                },
                                { data: { text: 'Final answer.', type: 'text' }, id: 'part-assistant' },
                            ],
                            role: 'assistant',
                        },
                    ],
                    projectId: 'project-1',
                    title: 'Think literal',
                },
            ],
        });

        const conversation = await opencodeConversationAdapter.getConversation({
            id: 'session-1',
            locations: { opencodeDbPath: dbPath },
            messageSelector: 'all',
            source: 'opencode',
        });

        expect(conversation?.messages).toContainEqual(
            expect.objectContaining({
                id: 'part-user',
                phase: 'unknown',
                role: 'user',
                text: '<think>literal user input</think>',
            }),
        );
        expect(conversation?.messages).not.toContainEqual(
            expect.objectContaining({ role: 'assistant', text: 'literal user input' }),
        );
        expect(
            conversation?.messages
                .filter((message) => message.role === 'tool')
                .map(({ phase, text }) => ({ phase, text })),
        ).toEqual([
            { phase: 'tool_call', text: 'read\n{\n  "path": "src/index.ts"\n}' },
            { phase: 'tool_output', text: 'file contents' },
        ]);
    });

    it('should list path-scoped OpenCode conversations within an updated-time window', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-adapter-list-'));
        tempDirs.push(tempDir);
        const dbPath = path.join(tempDir, 'opencode.db');
        await createOpenCodeFixture(dbPath, {
            projects: [{ id: 'project-1', timeUpdated: 200, worktree: '/repo' }],
            sessions: [
                {
                    id: 'session-in-window',
                    messages: [{ id: 'message-user', parts: [], role: 'user', timeCreated: 150 }],
                    projectId: 'project-1',
                    timeCreated: 100,
                    timeUpdated: 200,
                    title: 'Scoped OpenCode session',
                },
            ],
        });

        const conversations = await opencodeConversationAdapter.listConversationsForPath({
            cwd: '/repo',
            includeMessages: false,
            locations: { opencodeDbPath: dbPath },
            updatedAfterMs: 100,
            updatedBeforeMs: 300,
        });
        const excluded = await opencodeConversationAdapter.listConversationsForPath({
            cwd: '/repo',
            locations: { opencodeDbPath: dbPath },
            updatedAfterMs: 300,
        });

        expect(conversations.map(({ id }) => id)).toEqual(['session-in-window']);
        expect(conversations[0]?.matches[0]?.kind).toBe('exact');
        expect(conversations[0]?.messages).toEqual([]);
        expect(excluded).toEqual([]);
    });
});
