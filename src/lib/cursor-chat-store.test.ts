import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decodeCursorChatModel, resolveCursorChatStorePath } from './cursor-chat-store';

describe('Cursor chat stores', () => {
    it('should decode the persisted model and reasoning effort from modern chat blobs', () => {
        const blob = new TextEncoder().encode('\u0000other metadata\u0000cursor-grok-4.6-low\u0000');

        expect(decodeCursorChatModel([blob])).toEqual({ model: 'grok-4.6', reasoningEffort: 'low' });
    });

    it('should resolve a chat store through the trusted workspace path hash', async () => {
        const cursorDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-chat-store-'));
        const projectDir = path.join(cursorDir, 'projects', 'workspace-project');
        const composerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const storePath = path.join(cursorDir, 'chats', '3e5df7fc57ed37c7864c9a0f7ec0d12d', composerId, 'store.db');
        await mkdir(projectDir, { recursive: true });
        await mkdir(path.dirname(storePath), { recursive: true });
        await Bun.write(
            path.join(projectDir, '.workspace-trusted'),
            JSON.stringify({ workspacePath: '/Users/test/workspace/kalu' }),
        );
        await Bun.write(storePath, 'fixture');

        await expect(resolveCursorChatStorePath(projectDir, composerId)).resolves.toBe(storePath);
    });

    it('should reject malformed trusted workspace metadata', async () => {
        const cursorDir = await mkdtemp(path.join(os.tmpdir(), 'cursor-chat-store-escape-'));
        const projectDir = path.join(cursorDir, 'projects', 'workspace-project');
        await mkdir(projectDir, { recursive: true });
        await Bun.write(path.join(projectDir, '.workspace-trusted'), JSON.stringify({ workspacePath: null }));

        await expect(
            resolveCursorChatStorePath(projectDir, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        ).resolves.toBeNull();
    });
});
