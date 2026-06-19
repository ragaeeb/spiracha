import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listConversationsForPath, renderConversationMarkdown } from './index';
import type { ConversationMessage } from './types';

const createMessage = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
    createdAtMs: null,
    id: 'message',
    metadata: {},
    order: 0,
    phase: 'unknown',
    role: 'unknown',
    text: 'text',
    ...overrides,
});

describe('conversation data facade', () => {
    it('should keep all-source collection resilient when integrations are not installed', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conversation-data-empty-sources-'));
        try {
            const page = await listConversationsForPath({
                cwd: path.join(tempRoot, 'repo'),
                includeMessages: true,
                locations: {
                    antigravityRoots: [path.join(tempRoot, 'antigravity')],
                    claudeCodeProjectsDir: path.join(tempRoot, 'claude'),
                    codexDbPath: path.join(tempRoot, 'missing-codex.sqlite'),
                    cursorUserDir: path.join(tempRoot, 'cursor'),
                    kiroWorkspaceSessionsDir: path.join(tempRoot, 'kiro'),
                    opencodeDbPath: path.join(tempRoot, 'missing-opencode.sqlite'),
                    qoderGlobalStateDb: path.join(tempRoot, 'missing-qoder.sqlite'),
                    qoderWorkspaceStorageDir: path.join(tempRoot, 'qoder-workspaces'),
                },
                sources: 'all',
            });

            expect(page).toEqual({
                data: [],
                meta: { hasNext: false, nextCursor: null },
            });
        } finally {
            await rm(tempRoot, { force: true, recursive: true });
        }
    });

    it('should render markdown with the requested message selector', () => {
        const markdown = renderConversationMarkdown(
            {
                messages: [
                    createMessage({ order: 0, role: 'user', text: 'Please review this.' }),
                    createMessage({
                        order: 1,
                        phase: 'commentary',
                        role: 'assistant',
                        text: 'I am checking it.',
                    }),
                    createMessage({
                        order: 2,
                        phase: 'final_answer',
                        role: 'assistant',
                        text: 'The final review result.',
                    }),
                ],
                title: 'Review thread',
            },
            { messageSelector: 'last_final_answer' },
        );

        expect(markdown).toBe('# Review thread\n\n## assistant\n\nThe final review result.\n');
    });
});
