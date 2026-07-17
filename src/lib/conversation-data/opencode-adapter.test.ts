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
});
