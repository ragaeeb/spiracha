import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    listConversationSources,
    listConversations,
    renderConversationMarkdown,
    resolveConversationRef,
} from './index';
import type { ConversationMessage } from './types';

const createMessage = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
    createdAtMs: null,
    id: 'message',
    metadata: {},
    order: 0,
    phase: 'unknown',
    role: 'unknown',
    text: 'text',
    toolEvidence: null,
    ...overrides,
});

describe('conversation data facade', () => {
    it('should keep all-source collection resilient when integrations are not installed', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conversation-data-empty-sources-'));
        try {
            const page = await listConversations({
                cwd: path.join(tempRoot, 'repo'),
                includeMessages: true,
                locations: {
                    antigravityRoots: [path.join(tempRoot, 'antigravity')],
                    claudeCodeProjectsDir: path.join(tempRoot, 'claude'),
                    clineDataDir: path.join(tempRoot, 'cline'),
                    codexDbPath: path.join(tempRoot, 'missing-codex.sqlite'),
                    cursorUserDir: path.join(tempRoot, 'cursor'),
                    fxDataDir: path.join(tempRoot, 'fx'),
                    grokSessionsDir: path.join(tempRoot, 'grok', 'sessions'),
                    kiroWorkspaceSessionsDir: path.join(tempRoot, 'kiro'),
                    minimaxCodeSessionsDir: path.join(tempRoot, 'minimax-code'),
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

    it('should warn when all-source collection skips a broken integration', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conversation-data-broken-source-'));
        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => warnings.push(args);
        try {
            const qoderDbPath = path.join(tempRoot, 'qoder.sqlite');
            await Bun.write(qoderDbPath, 'not a sqlite database');
            await listConversations({
                cwd: path.join(tempRoot, 'repo'),
                locations: {
                    antigravityRoots: [path.join(tempRoot, 'antigravity')],
                    claudeCodeProjectsDir: path.join(tempRoot, 'claude'),
                    clineDataDir: path.join(tempRoot, 'cline'),
                    codexDbPath: path.join(tempRoot, 'missing-codex.sqlite'),
                    cursorUserDir: path.join(tempRoot, 'cursor'),
                    fxDataDir: path.join(tempRoot, 'fx'),
                    grokSessionsDir: path.join(tempRoot, 'grok', 'sessions'),
                    kiroWorkspaceSessionsDir: path.join(tempRoot, 'kiro'),
                    minimaxCodeSessionsDir: path.join(tempRoot, 'minimax-code'),
                    opencodeDbPath: path.join(tempRoot, 'missing-opencode.sqlite'),
                    qoderGlobalStateDb: qoderDbPath,
                    qoderWorkspaceStorageDir: path.join(tempRoot, 'qoder-workspaces'),
                },
                sources: 'all',
            });

            expect(warnings.some((warning) => String(warning[0]).includes('qoder'))).toBe(true);
        } finally {
            console.warn = originalWarn;
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
                model: 'anthropic/claude-sonnet-4.5',
                title: 'Review thread',
            },
            { messageSelector: 'last_final_answer' },
        );

        expect(markdown).toBe('# Review thread\n\n## Claude Sonnet 4.5\n\nThe final review result.\n');
    });

    it('should render stable markdown for empty and unknown-role messages', () => {
        expect(
            renderConversationMarkdown({
                messages: [createMessage({ role: 'unknown', text: '' })],
                title: null,
            }),
        ).toBe('# Conversation\n\n## Unknown\n\n_No message content._\n');

        expect(
            renderConversationMarkdown(
                {
                    messages: [],
                    title: 'Empty thread',
                },
                { messageSelector: 'last_final_answer' },
            ),
        ).toBe('# Empty thread\n\n_No messages selected._\n');
    });

    it('should reject malformed local pagination cursors', async () => {
        await expect(
            listConversations({
                cursor: Buffer.from('12garbage').toString('base64url'),
                cwd: '/repo',
                sources: [],
            }),
        ).rejects.toThrow('Invalid conversation pagination cursor.');
    });

    it('should return an isolated scoped source metadata array', async () => {
        const first = await listConversationSources();
        expect(first).toContainEqual({ label: 'Cline', scope: 'workspace', source: 'cline' });
        expect(first).toContainEqual({ label: 'MiniMax Code', scope: 'workspace', source: 'minimax-code' });
        expect(first).toContainEqual({ label: 'FX', scope: 'workspace', source: 'fx' });
        expect(first).toContainEqual({ label: 'Grok Bot', scope: 'global', source: 'grok-bot' });
        first.splice(0, first.length);

        expect(await listConversationSources()).not.toEqual([]);
    });

    it('should keep global chats out of workspace-scoped collection', async () => {
        await expect(
            listConversations({
                cwd: '/repo',
                sources: ['grok-bot'],
            }),
        ).rejects.toThrow('global source');
        await expect(
            listConversations({
                sources: ['codex'],
            }),
        ).rejects.toThrow('workspace source');
    });

    it('should resolve only exact supported UI route prefixes', async () => {
        await expect(resolveConversationRef('https://example.com/threads/thread-1')).resolves.toEqual({
            id: 'thread-1',
            source: 'codex',
        });
        await expect(
            resolveConversationRef('https://example.com/grok-bot-chats/bd5bbf01-a4e1-47f8-885f-f2188cf04aab'),
        ).resolves.toEqual({
            id: 'bd5bbf01-a4e1-47f8-885f-f2188cf04aab',
            source: 'grok-bot',
        });
        await expect(resolveConversationRef('https://example.com/unrelated/threads/thread-1')).resolves.toBeNull();
    });
});
