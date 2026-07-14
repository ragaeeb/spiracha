import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexBrowserFixture } from '../codex-test-helpers';
import { createCursorFixture } from '../cursor-test-helpers';
import { createOpenCodeFixture } from '../opencode-test-helpers';
import { deleteConversation, deleteConversations, getConversation, listConversationsForPath } from './index';

const tempRoots: string[] = [];

const makeTempRoot = async (prefix: string) => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempRoots.push(tempRoot);
    return tempRoot;
};

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const writeJsonl = async (filePath: string, records: unknown[]) => {
    await Bun.write(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
};

const writeClaudeSession = async (projectsDir: string, workspacePath: string, sessionId: string) => {
    const projectDirName = workspacePath.replace(/\//gu, '-');
    const projectDir = path.join(projectsDir, projectDirName);
    const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);
    await mkdir(projectDir, { recursive: true });
    await writeJsonl(sessionPath, [
        {
            cwd: workspacePath,
            message: { content: 'Delete via public API', role: 'user' },
            sessionId,
            timestamp: '2026-06-01T10:00:00.000Z',
            type: 'user',
            uuid: `${sessionId}-user`,
        },
    ]);
    return sessionPath;
};

const encodeKiroWorkspaceDirectoryName = (workspacePath: string) =>
    Buffer.from(workspacePath, 'utf8')
        .toString('base64')
        .replace(/=+$/u, (match) => '_'.repeat(match.length));

const getKiroWorkspaceHash = (workspacePath: string) =>
    createHash('sha256').update(workspacePath).digest('hex').slice(0, 32);

const writeKiroSession = async (sessionsDir: string, workspacePath: string, sessionId: string) => {
    const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));
    const executionPath = path.join(sessionsDir, getKiroWorkspaceHash(workspacePath), 'execution', 'delete.json');
    const sessionPath = path.join(workspaceDir, `${sessionId}.json`);
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(path.dirname(executionPath), { recursive: true });
    await Bun.write(
        path.join(workspaceDir, 'sessions.json'),
        JSON.stringify([
            { dateCreated: '1781212901555', sessionId, title: 'Delete Kiro', workspaceDirectory: workspacePath },
        ]),
    );
    await Bun.write(
        sessionPath,
        JSON.stringify({
            history: [{ message: { content: 'Delete via public API', id: `${sessionId}-user`, role: 'user' } }],
            sessionId,
            title: 'Delete Kiro',
            updatedAt: 1_781_212_904_000,
            workspaceDirectory: workspacePath,
        }),
    );
    await Bun.write(executionPath, JSON.stringify({ actions: [], chatSessionId: sessionId }));
    return { executionPath, sessionPath };
};

const createOpenCodeDb = async () => {
    const dbPath = path.join(await makeTempRoot('conversation-delete-opencode-'), 'opencode.db');
    await createOpenCodeFixture(dbPath, {
        projects: [{ id: 'project-delete', name: null, timeUpdated: 1_700_000_000_000, worktree: '/repo' }],
        sessions: [
            {
                id: 'session-delete',
                messages: [{ id: 'message-delete', parts: [], role: 'user', timeCreated: 1_700_000_000_100 }],
                projectId: 'project-delete',
                timeCreated: 1_700_000_000_000,
                timeUpdated: 1_700_000_000_200,
                title: 'Delete OpenCode',
            },
            {
                id: 'session-child',
                messages: [{ id: 'message-child', parts: [], role: 'assistant', timeCreated: 1_700_000_000_300 }],
                parentId: 'session-delete',
                projectId: 'project-delete',
                timeCreated: 1_700_000_000_250,
                timeUpdated: 1_700_000_000_400,
                title: 'Delete OpenCode child',
            },
        ],
    });
    return dbPath;
};

describe('conversation delete adapters', () => {
    it('should delete Codex conversations and rollout files through the stable facade', async () => {
        const fixture = await createCodexBrowserFixture(await makeTempRoot('conversation-delete-codex-'));
        const thread = fixture.threads[0]!;

        const result = await deleteConversation({
            id: thread.threadId,
            locations: { codexDbPath: fixture.dbPath },
            source: 'codex',
        });

        expect(result).toEqual({
            deletedFiles: [thread.sessionFile],
            deletedIds: [thread.threadId],
        });
        expect(await Bun.file(thread.sessionFile).exists()).toBe(false);
        await expect(
            getConversation({ id: thread.threadId, locations: { codexDbPath: fixture.dbPath }, source: 'codex' }),
        ).resolves.toBeNull();
    });

    it('should delete explicit Codex conversation sets through the stable facade', async () => {
        const fixture = await createCodexBrowserFixture(await makeTempRoot('conversation-delete-codex-batch-'));
        const threads = fixture.threads.slice(0, 2);

        const result = await deleteConversations({
            ids: threads.map((thread) => thread.threadId),
            locations: { codexDbPath: fixture.dbPath },
            source: 'codex',
        });

        expect(result).toEqual({
            deletedFiles: threads.map((thread) => thread.sessionFile),
            deletedIds: threads.map((thread) => thread.threadId),
            missingIds: [],
            results: threads.map((thread) => ({
                deleted: true,
                deletedFiles: [thread.sessionFile],
                deletedIds: [thread.threadId],
                id: thread.threadId,
            })),
        });
        await Promise.all(
            threads.map(async (thread) => {
                expect(await Bun.file(thread.sessionFile).exists()).toBe(false);
            }),
        );
    });

    it('should count descendant ids deleted by an earlier cascading delete as deleted', async () => {
        const dbPath = await createOpenCodeDb();

        const result = await deleteConversations({
            ids: ['session-delete', 'session-child'],
            locations: { opencodeDbPath: dbPath },
            source: 'opencode',
        });

        expect(result?.missingIds).toEqual([]);
        expect(result?.results).toEqual([
            expect.objectContaining({ deleted: true, id: 'session-delete' }),
            expect.objectContaining({ deleted: true, id: 'session-child' }),
        ]);
    });

    it('should delete Claude Code sessions through the stable facade without treating ids as paths', async () => {
        const projectsDir = await makeTempRoot('conversation-delete-claude-');
        const sessionPath = await writeClaudeSession(projectsDir, '/repo', 'session-delete');

        const result = await deleteConversation({
            id: 'session-delete',
            locations: { claudeCodeProjectsDir: projectsDir },
            source: 'claude-code',
        });
        const traversal = await deleteConversation({
            id: '../session-delete',
            locations: { claudeCodeProjectsDir: projectsDir },
            source: 'claude-code',
        });

        expect(result).toEqual({ deletedFiles: [sessionPath], deletedIds: ['session-delete'] });
        expect(traversal).toEqual({ deletedFiles: [], deletedIds: [] });
        expect(await Bun.file(sessionPath).exists()).toBe(false);
    });

    it('should delete Kiro sessions, index entries, and execution files through the stable facade', async () => {
        const sessionsDir = await makeTempRoot('conversation-delete-kiro-');
        const { executionPath, sessionPath } = await writeKiroSession(sessionsDir, '/repo', 'session-delete');

        const result = await deleteConversation({
            id: 'session-delete',
            locations: { kiroWorkspaceSessionsDir: sessionsDir },
            source: 'kiro',
        });

        expect(result?.deletedIds).toEqual(['session-delete']);
        expect(result?.deletedFiles.sort()).toEqual([executionPath, sessionPath].sort());
        expect(await Bun.file(sessionPath).exists()).toBe(false);
        expect(await Bun.file(executionPath).exists()).toBe(false);
    });

    it('should delete Cursor threads through the stable facade using an exact composer id', async () => {
        const userDir = await makeTempRoot('conversation-delete-cursor-');
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'bucket-1',
                    composerIds: ['thread-delete'],
                    folder: 'file:///repo',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [{ bucketId: 'bucket-1', composerId: 'thread-delete', uriPath: '/repo' }],
            threads: [
                {
                    bubbles: [{ bubbleId: 'bubble-1', text: 'Delete via public API', type: 1 }],
                    composerId: 'thread-delete',
                    name: 'Delete Cursor',
                },
                {
                    bubbles: [{ bubbleId: 'bubble-keep', text: 'Keep me', type: 1 }],
                    composerId: 'thread-keep',
                    name: 'Keep Cursor',
                },
            ],
        });

        const result = await deleteConversation({
            id: 'thread-delete',
            locations: { cursorUserDir: userDir },
            source: 'cursor',
        });

        expect(result).toEqual({ deletedFiles: [], deletedIds: ['thread-delete'] });
        expect(
            await getConversation({ id: 'thread-delete', locations: { cursorUserDir: userDir }, source: 'cursor' }),
        ).toBeNull();
        expect(
            await getConversation({ id: 'thread-keep', locations: { cursorUserDir: userDir }, source: 'cursor' }),
        ).not.toBeNull();
    });

    it('should delete Antigravity conversations through the stable facade without accepting unsafe ids', async () => {
        const root = await makeTempRoot('conversation-delete-antigravity-');
        const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const conversationPath = path.join(root, 'conversations', `${conversationId}.pb`);
        await mkdir(path.dirname(conversationPath), { recursive: true });
        await Bun.write(conversationPath, new Uint8Array([1, 2, 3]));

        const result = await deleteConversation({
            id: conversationId,
            locations: { antigravityRoots: [root] },
            source: 'antigravity',
        });
        const unsafeResult = await deleteConversation({
            id: '../conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            locations: { antigravityRoots: [root] },
            source: 'antigravity',
        });

        expect(result).toEqual({ deletedFiles: [conversationPath], deletedIds: [conversationId] });
        expect(unsafeResult).toEqual({ deletedFiles: [], deletedIds: [] });
        expect(await Bun.file(conversationPath).exists()).toBe(false);
    });

    it('should delete OpenCode sessions and child sessions through the stable facade', async () => {
        const dbPath = await createOpenCodeDb();

        const result = await deleteConversation({
            id: 'session-delete',
            locations: { opencodeDbPath: dbPath },
            source: 'opencode',
        });

        expect(result).toEqual({ deletedFiles: [], deletedIds: ['session-delete', 'session-child'] });
        const db = new Database(dbPath);
        try {
            expect(db.query('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 0 });
            expect(db.query('SELECT COUNT(*) AS count FROM message').get()).toEqual({ count: 0 });
        } finally {
            db.close();
        }
    });

    it('should keep Qoder delete unsupported until a safe source-specific delete primitive exists', async () => {
        await expect(deleteConversation({ id: 'session-delete', source: 'qoder' })).resolves.toBeNull();
    });

    it('should return not-found style delete results for missing supported conversations', async () => {
        const projectsDir = await makeTempRoot('conversation-delete-missing-');

        await expect(
            deleteConversation({
                id: 'missing-session',
                locations: { claudeCodeProjectsDir: projectsDir },
                source: 'claude-code',
            }),
        ).resolves.toEqual({ deletedFiles: [], deletedIds: [] });

        await expect(
            listConversationsForPath({
                cwd: '/repo',
                locations: { claudeCodeProjectsDir: projectsDir },
                sources: ['claude-code'],
            }),
        ).resolves.toEqual({ data: [], meta: { hasNext: false, nextCursor: null } });
    });
});
