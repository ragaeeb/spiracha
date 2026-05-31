import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteCodexProject,
    deleteCodexThread,
    getCodexDashboardSummary,
    getThreadBrowseData,
    listCodexProjects,
    listProjectThreads,
    withReadonlyDb,
} from './codex-browser-db';
import { createCodexBrowserFixture } from './codex-test-helpers';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

const createLiveSchemaDeleteFixture = async (tempRoot: string) => {
    const dbPath = path.join(tempRoot, 'state.sqlite');
    const sessionFile = path.join(tempRoot, 'sessions', '2026', '05', '22', 'rollout-thread-live.jsonl');
    const threadId = 'thread-live';
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await Bun.write(sessionFile, JSON.stringify({ type: 'session_meta' }));

    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE threads (
            id TEXT PRIMARY KEY,
            rollout_path TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            source TEXT NOT NULL,
            model_provider TEXT NOT NULL,
            cwd TEXT NOT NULL,
            title TEXT NOT NULL,
            sandbox_policy TEXT NOT NULL,
            approval_mode TEXT NOT NULL,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            has_user_event INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            archived_at INTEGER,
            git_sha TEXT,
            git_branch TEXT,
            git_origin_url TEXT,
            cli_version TEXT NOT NULL DEFAULT '',
            first_user_message TEXT NOT NULL DEFAULT '',
            agent_nickname TEXT,
            agent_role TEXT,
            memory_mode TEXT NOT NULL DEFAULT 'enabled',
            model TEXT,
            reasoning_effort TEXT,
            agent_path TEXT,
            created_at_ms INTEGER,
            updated_at_ms INTEGER,
            thread_source TEXT,
            preview TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE thread_dynamic_tools (
            thread_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            input_schema TEXT NOT NULL,
            defer_loading INTEGER NOT NULL DEFAULT 0,
            namespace TEXT,
            PRIMARY KEY(thread_id, position)
        );

        CREATE TABLE thread_spawn_edges (
            parent_thread_id TEXT NOT NULL,
            child_thread_id TEXT NOT NULL PRIMARY KEY,
            status TEXT NOT NULL
        );

        CREATE TABLE stage1_outputs (
            thread_id TEXT PRIMARY KEY,
            source_updated_at INTEGER NOT NULL,
            raw_memory TEXT NOT NULL,
            rollout_summary TEXT NOT NULL,
            generated_at INTEGER NOT NULL
        );
    `);

    db.prepare(`
        INSERT INTO threads (
            id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
            sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version,
            first_user_message, memory_mode, model, created_at_ms, updated_at_ms, preview
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        threadId,
        sessionFile,
        1,
        2,
        'vscode',
        'openai',
        '/Users/user/workspace/ushman',
        'Live schema thread',
        '{"type":"danger-full-access"}',
        'never',
        42,
        1,
        0,
        '0.1.0',
        'First prompt',
        'enabled',
        'gpt-5.4',
        1000,
        2000,
        'First prompt',
    );
    db.prepare(`
        INSERT INTO thread_dynamic_tools (
            thread_id, position, name, description, input_schema, defer_loading, namespace
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(threadId, 0, 'exec_command', 'Run commands', '{"type":"object"}', 0, null);
    db.prepare(`
        INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status)
        VALUES (?, ?, ?)
    `).run(threadId, 'thread-child', 'completed');
    db.prepare(`
        INSERT INTO stage1_outputs (thread_id, source_updated_at, raw_memory, rollout_summary, generated_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(threadId, 2000, 'memory', 'summary', 3000);
    db.close();

    return {
        dbPath,
        sessionFile,
        threadId,
    };
};

const createMinimalBrowseSchemaFixture = async (tempRoot: string) => {
    const dbPath = path.join(tempRoot, 'state.sqlite');
    const sessionFile = path.join(tempRoot, 'sessions', '2026', '05', '24', 'rollout-thread-minimal.jsonl');
    const threadId = 'thread-minimal';
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await Bun.write(sessionFile, JSON.stringify({ type: 'session_meta' }));

    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE threads (
            id TEXT PRIMARY KEY,
            rollout_path TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            source TEXT NOT NULL,
            model_provider TEXT NOT NULL,
            cwd TEXT NOT NULL,
            title TEXT NOT NULL,
            sandbox_policy TEXT NOT NULL,
            approval_mode TEXT NOT NULL,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            has_user_event INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            archived_at INTEGER,
            git_sha TEXT,
            git_branch TEXT,
            git_origin_url TEXT,
            cli_version TEXT NOT NULL DEFAULT '',
            first_user_message TEXT NOT NULL DEFAULT '',
            agent_nickname TEXT,
            agent_role TEXT,
            memory_mode TEXT NOT NULL DEFAULT 'enabled',
            model TEXT,
            reasoning_effort TEXT,
            agent_path TEXT,
            created_at_ms INTEGER,
            updated_at_ms INTEGER,
            thread_source TEXT,
            preview TEXT NOT NULL DEFAULT ''
        );
    `);

    db.prepare(`
        INSERT INTO threads (
            id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
            sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version,
            first_user_message, memory_mode, model, created_at_ms, updated_at_ms, preview
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        threadId,
        sessionFile,
        1,
        2,
        'vscode',
        'openai',
        '/Users/user/workspace/legacy',
        'Minimal schema thread',
        '{"type":"read-only"}',
        'never',
        7,
        1,
        0,
        '0.1.0',
        'Legacy prompt',
        'enabled',
        'gpt-5.4',
        1000,
        2000,
        'Legacy prompt',
    );
    db.close();

    return {
        dbPath,
        threadId,
    };
};

const createLargeProjectDeleteFixture = async (tempRoot: string, threadCount: number) => {
    const dbPath = path.join(tempRoot, 'state.sqlite');
    const sessionsRoot = path.join(tempRoot, 'sessions');
    const projectCwd = '/Users/user/workspace/big-project';
    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE threads (
            id TEXT PRIMARY KEY,
            rollout_path TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            source TEXT NOT NULL,
            model_provider TEXT NOT NULL,
            cwd TEXT NOT NULL,
            title TEXT NOT NULL,
            sandbox_policy TEXT NOT NULL,
            approval_mode TEXT NOT NULL,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            has_user_event INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            archived_at INTEGER,
            git_sha TEXT,
            git_branch TEXT,
            git_origin_url TEXT,
            cli_version TEXT NOT NULL DEFAULT '',
            first_user_message TEXT NOT NULL DEFAULT '',
            agent_nickname TEXT,
            agent_role TEXT,
            memory_mode TEXT NOT NULL DEFAULT 'enabled',
            model TEXT,
            reasoning_effort TEXT,
            agent_path TEXT,
            created_at_ms INTEGER,
            updated_at_ms INTEGER,
            thread_source TEXT,
            preview TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE thread_spawn_edges (
            parent_thread_id TEXT NOT NULL,
            child_thread_id TEXT NOT NULL,
            status TEXT NOT NULL
        );
    `);

    const insertThread = db.prepare(`
        INSERT INTO threads (
            id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
            sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version,
            first_user_message, memory_mode, model, created_at_ms, updated_at_ms, preview
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEdge = db.prepare(`
        INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status)
        VALUES (?, ?, ?)
    `);

    for (let index = 0; index < threadCount; index += 1) {
        const threadId = `thread-${index}`;
        const sessionFile = path.join(sessionsRoot, `rollout-${index}.jsonl`);
        await mkdir(path.dirname(sessionFile), { recursive: true });
        await Bun.write(sessionFile, JSON.stringify({ type: 'session_meta' }));
        insertThread.run(
            threadId,
            sessionFile,
            index + 1,
            index + 2,
            'vscode',
            'openai',
            projectCwd,
            `Thread ${index}`,
            '{"type":"danger-full-access"}',
            'never',
            1,
            1,
            0,
            '0.1.0',
            'Prompt',
            'enabled',
            'gpt-5.4',
            (index + 1) * 1000,
            (index + 2) * 1000,
            'Prompt',
        );
        if (index > 0) {
            insertEdge.run(`thread-${index - 1}`, threadId, 'done');
        }
    }

    db.close();

    return {
        dbPath,
        projectName: 'big-project',
        sessionsRoot,
    };
};

describe('codex browser db', () => {
    it('should group live threads into portable project summaries', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-projects-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const projects = listCodexProjects(fixture.dbPath);

        expect(projects.map((project) => project.name)).toEqual(['spiracha', 'shibuk']);
        expect(projects[0]).toMatchObject({
            archivedThreadCount: 0,
            name: 'spiracha',
            threadCount: 2,
            totalTokens: 640791,
        });
        expect(projects[1]).toMatchObject({
            archivedThreadCount: 1,
            name: 'shibuk',
            threadCount: 1,
            totalTokens: 91000,
        });
    });

    it('should return project thread rows sorted by update time and include browse metadata', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-threads-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const threads = await listProjectThreads(fixture.dbPath, 'spiracha');
        const threadDetails = getThreadBrowseData(fixture.dbPath, fixture.threads[0]!.threadId);

        expect(threads).toHaveLength(2);
        expect(threads.map((thread) => thread.thread.id)).toEqual([
            fixture.threads[0]!.threadId,
            fixture.threads[1]!.threadId,
        ]);
        expect(threadDetails.dynamicTools).toHaveLength(2);
        expect(threadDetails.relations.childEdges).toHaveLength(1);
        expect(threadDetails.thread.preview).toBe('Build the Spiracha UI');
        expect(threads[0]?.stats.deferred).toBe(false);
        expect(threads[0]?.rolloutSizeBytes).toBeGreaterThan(0);
    });

    it('should tolerate browse reads on schemas without optional relation or tool tables', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-minimal-browse-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createMinimalBrowseSchemaFixture(tempRoot);

        const threadDetails = getThreadBrowseData(fixture.dbPath, fixture.threadId);

        expect(threadDetails.dynamicTools).toEqual([]);
        expect(threadDetails.relations.childEdges).toEqual([]);
        expect(threadDetails.relations.parentThreadId).toBeNull();
    });

    it('should skip transcript stat parsing for oversized rollouts in project thread lists', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-large-rollout-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const threads = await listProjectThreads(fixture.dbPath, 'spiracha', {
            largeTranscriptThresholdBytes: 1,
        });

        expect(threads).toHaveLength(2);
        expect(threads[0]?.stats).toMatchObject({
            deferred: true,
            execCommandCount: 0,
            toolCallCount: 0,
            webSearchEventCount: 0,
        });
        expect(threads[0]?.rolloutSizeBytes).toBeGreaterThan(1);
        expect(threads[0]?.thread.title.includes('\n')).toBe(false);
    });

    it('should delete a thread row and its dependent records without touching the rollout file', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-delete-thread-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const threadId = fixture.threads[0]!.threadId;
        const sessionFile = fixture.threads[0]!.sessionFile;

        const result = await deleteCodexThread(fixture.dbPath, threadId);

        expect(result.deletedThreadIds).toEqual([threadId]);
        expect(await Bun.file(sessionFile).exists()).toBe(true);

        const db = new Database(fixture.dbPath, { readonly: true });
        expect(db.query('SELECT COUNT(*) AS count FROM threads WHERE id = ?').get(threadId)).toEqual({ count: 0 });
        expect(
            db.query('SELECT COUNT(*) AS count FROM thread_dynamic_tools WHERE thread_id = ?').get(threadId),
        ).toEqual({ count: 0 });
        expect(
            db
                .query(
                    'SELECT COUNT(*) AS count FROM thread_spawn_edges WHERE parent_thread_id = ? OR child_thread_id = ?',
                )
                .get(threadId, threadId),
        ).toEqual({ count: 0 });
        db.close();
    });

    it('should delete a thread against the live schema even when optional tables are absent', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-live-delete-thread-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createLiveSchemaDeleteFixture(tempRoot);

        const result = await deleteCodexThread(fixture.dbPath, fixture.threadId);

        expect(result.deletedThreadIds).toEqual([fixture.threadId]);
        expect(await Bun.file(fixture.sessionFile).exists()).toBe(true);

        const db = new Database(fixture.dbPath, { readonly: true });
        expect(db.query('SELECT COUNT(*) AS count FROM threads WHERE id = ?').get(fixture.threadId)).toEqual({
            count: 0,
        });
        expect(
            db.query('SELECT COUNT(*) AS count FROM thread_dynamic_tools WHERE thread_id = ?').get(fixture.threadId),
        ).toEqual({ count: 0 });
        expect(
            db.query('SELECT COUNT(*) AS count FROM stage1_outputs WHERE thread_id = ?').get(fixture.threadId),
        ).toEqual({
            count: 0,
        });
        db.close();
    });

    it('should delete the rollout session file when requested', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-delete-thread-session-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const threadId = fixture.threads[0]!.threadId;
        const sessionFile = fixture.threads[0]!.sessionFile;

        const result = await deleteCodexThread(fixture.dbPath, threadId, {
            deleteSessionFiles: true,
        });

        expect(result.deletedThreadIds).toEqual([threadId]);
        expect(await Bun.file(sessionFile).exists()).toBe(false);
    });

    it('should delete all threads that match a derived project basename', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-delete-project-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const result = await deleteCodexProject(fixture.dbPath, 'spiracha');
        const summary = getCodexDashboardSummary(fixture.dbPath);

        expect(result.projectName).toBe('spiracha');
        expect(result.deletedThreadIds).toHaveLength(2);
        expect(summary.totalProjects).toBe(1);
        expect(summary.totalThreads).toBe(1);
        expect(summary.totalTokens).toBe(91000);
    });

    it('should include project names for recent dashboard threads', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-dashboard-recent-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const summary = getCodexDashboardSummary(fixture.dbPath);

        expect(summary.recentThreads[0]).toMatchObject({
            project: 'spiracha',
            thread: {
                id: fixture.threads[0]!.threadId,
            },
        });
    });

    it('should delete all project session files when requested', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-delete-project-session-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const spirachaSessionFiles = fixture.threads
            .filter((thread) => thread.project === 'spiracha')
            .map((thread) => thread.sessionFile);

        const result = await deleteCodexProject(fixture.dbPath, 'spiracha', {
            deleteSessionFiles: true,
        });

        expect(result.deletedThreadIds).toHaveLength(2);
        expect(result.deletedSessionFiles).toHaveLength(2);
        await Promise.all(
            spirachaSessionFiles.map(async (sessionFile) => {
                expect(await Bun.file(sessionFile).exists()).toBe(false);
            }),
        );
    });

    it('should reject async database callbacks before closing the connection early', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-async-callback-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createMinimalBrowseSchemaFixture(tempRoot);

        expect(() =>
            withReadonlyDb(fixture.dbPath, async () => {
                return 'nope';
            }),
        ).toThrow('Database callbacks must be synchronous');
    });

    it('should delete very large projects without exceeding SQLite parameter limits', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-large-project-delete-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createLargeProjectDeleteFixture(tempRoot, 520);

        const result = await deleteCodexProject(fixture.dbPath, fixture.projectName, {
            deleteSessionFiles: true,
        });

        expect(result.deletedThreadIds).toHaveLength(520);
        expect(result.deletedSessionFiles).toHaveLength(520);

        const db = new Database(fixture.dbPath, { readonly: true });
        expect(db.query('SELECT COUNT(*) AS count FROM threads').get()).toEqual({ count: 0 });
        expect(db.query('SELECT COUNT(*) AS count FROM thread_spawn_edges').get()).toEqual({ count: 0 });
        db.close();

        expect(await Bun.file(path.join(fixture.sessionsRoot, 'rollout-0.jsonl')).exists()).toBe(false);
        expect(await Bun.file(path.join(fixture.sessionsRoot, 'rollout-519.jsonl')).exists()).toBe(false);
    });
});
