import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    CodexThreadNotFoundError,
    deleteCodexProject,
    deleteCodexThread,
    deleteCodexThreads,
    getCodexDashboardSummary,
    getThreadBrowseData,
    listCodexProjects,
    listProjectThreads,
    listScopedThreads,
    mergeSessionIndexLinesForRewrite,
    resolveCodexThreadDbPath,
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
    it('should preserve concurrent session-index appends while removing deleted threads', () => {
        const initialLines = [
            JSON.stringify({ id: 'keep', thread_name: 'Keep' }),
            JSON.stringify({ id: 'delete', thread_name: 'Delete' }),
        ];
        const appendedLine = JSON.stringify({ id: 'appended', thread_name: 'Appended by Codex' });

        expect(
            mergeSessionIndexLinesForRewrite(
                initialLines,
                [initialLines[0]!],
                [...initialLines, appendedLine],
                new Set(['delete']),
            ),
        ).toEqual([initialLines[0], appendedLine]);
    });

    it('should read a WAL database after a clean shutdown removed the sidecar files', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-wal-'));
        tempPaths.push(tempRoot);
        const dbPath = path.join(tempRoot, 'state.sqlite');

        const writable = new Database(dbPath);
        writable.exec('PRAGMA journal_mode=WAL');
        writable.exec('CREATE TABLE threads(id TEXT PRIMARY KEY)');
        writable.query('INSERT INTO threads VALUES (?)').run('thread-1');
        writable.close();
        await rm(`${dbPath}-wal`, { force: true });
        await rm(`${dbPath}-shm`, { force: true });

        const row = withReadonlyDb(dbPath, (db) => {
            return db.query('SELECT COUNT(*) AS count FROM threads').get() as { count: number };
        });

        expect(row.count).toBe(1);
    });

    it('should group live threads into portable project summaries', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-projects-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const projects = await listCodexProjects(fixture.dbPath);

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

    it('should query only aggregate and recent-thread columns for dashboard summaries', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-targeted-dashboard-test-'));
        tempPaths.push(tempRoot);
        const dbPath = path.join(tempRoot, 'state.sqlite');
        const db = new Database(dbPath);
        db.exec(`
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                cwd TEXT NOT NULL,
                title TEXT NOT NULL,
                preview TEXT NOT NULL,
                first_user_message TEXT NOT NULL,
                model TEXT,
                tokens_used INTEGER NOT NULL,
                archived INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                updated_at_ms INTEGER
            );
            INSERT INTO threads VALUES (
                'targeted-thread',
                'missing-rollout.jsonl',
                '/workspace/spiracha',
                'Targeted queries',
                'Keep dashboard payloads compact',
                'Keep dashboard payloads compact',
                'gpt-5.4',
                1200,
                0,
                1779037924,
                1779037924000
            );
        `);
        db.close();

        const projects = await listCodexProjects(dbPath);
        const dashboard = await getCodexDashboardSummary(dbPath);

        expect(projects).toEqual([
            {
                archivedThreadCount: 0,
                cwdPaths: ['/workspace/spiracha'],
                lastUpdatedAtMs: 1779037924000,
                modelNames: ['gpt-5.4'],
                name: 'spiracha',
                threadCount: 1,
                totalTokens: 1200,
            },
        ]);
        expect(dashboard).toMatchObject({
            activeThreads: 1,
            archivedThreads: 0,
            recentThreads: [
                {
                    project: 'spiracha',
                    thread: {
                        id: 'targeted-thread',
                        title: 'Targeted queries',
                    },
                },
            ],
            totalProjects: 1,
            totalThreads: 1,
            totalTokens: 1200,
        });
    });

    it('should read rollout activity without blocking the synchronous request path', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-async-activity-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const projects = listCodexProjects(fixture.dbPath);
        const dashboard = getCodexDashboardSummary(fixture.dbPath);

        expect(projects).toBeInstanceOf(Promise);
        expect(dashboard).toBeInstanceOf(Promise);
        await Promise.all([projects, dashboard]);
    });

    it('should filter project threads in SQLite before hydrating rows', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-sql-filter-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const db = new Database(fixture.dbPath);
        db.exec("UPDATE threads SET cwd = zeroblob(16) WHERE cwd LIKE '%shibuk'");
        db.close();

        const threads = await listProjectThreads(fixture.dbPath, 'spiracha', {
            includeTranscriptStats: false,
        });

        expect(threads).toHaveLength(2);
        expect(threads.every((entry) => entry.project === 'spiracha')).toBe(true);
    });

    it('should select only declared thread columns for project listings', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-column-list-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const db = new Database(fixture.dbPath);
        db.exec("ALTER TABLE threads ADD COLUMN private_data TEXT DEFAULT 'must-not-leak'");
        db.close();

        const threads = await listProjectThreads(fixture.dbPath, 'spiracha', {
            includeTranscriptStats: false,
        });

        expect(threads).toHaveLength(2);
        expect(threads[0]?.thread).not.toHaveProperty('private_data');
    });

    it('should include project threads that only exist in the session index and rollout files', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-fallback-project-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const fallbackThreadId = '019ec3d5-859d-77d0-b851-256ae567ff62';
        const fallbackSessionFile = path.join(
            tempRoot,
            'sessions',
            '2026',
            '06',
            '13',
            `rollout-2026-06-13T21-53-31-${fallbackThreadId}.jsonl`,
        );

        await mkdir(path.dirname(fallbackSessionFile), { recursive: true });
        await Bun.write(
            fallbackSessionFile,
            [
                {
                    payload: {
                        cli_version: '0.140.0-alpha.2',
                        cwd: '/Users/user/workspace/spiracha',
                        dynamic_tools: [
                            {
                                defer_loading: true,
                                description: 'Run a command.',
                                input_schema: { properties: { cmd: { type: 'string' } }, type: 'object' },
                                name: 'exec_command',
                                namespace: 'codex',
                            },
                        ],
                        id: fallbackThreadId,
                        model_provider: 'openai',
                        originator: 'Codex Desktop',
                        source: 'vscode',
                        thread_source: 'user',
                        timestamp: '2026-06-14T01:53:31.047Z',
                    },
                    timestamp: '2026-06-14T01:57:28.908Z',
                    type: 'session_meta',
                },
                {
                    payload: {
                        model: 'gpt-5.5',
                        turn_id: 'turn-1',
                    },
                    timestamp: '2026-06-14T01:57:29.000Z',
                    type: 'turn_context',
                },
                {
                    payload: {
                        info: {
                            total_token_usage: {
                                total_tokens: 123456,
                            },
                        },
                        type: 'token_count',
                    },
                    timestamp: '2026-06-14T01:57:30.000Z',
                    type: 'event_msg',
                },
            ]
                .map((entry) => JSON.stringify(entry))
                .join('\n'),
        );
        await Bun.write(
            path.join(tempRoot, 'session_index.jsonl'),
            JSON.stringify({
                id: fallbackThreadId,
                thread_name: 'Map pipeline unknowns',
                updated_at: '2026-06-14T01:57:34.149424Z',
            }),
        );

        const threads = await listProjectThreads(fixture.dbPath, 'spiracha');
        const projects = await listCodexProjects(fixture.dbPath);
        const dashboard = await getCodexDashboardSummary(fixture.dbPath);
        const fallbackDetails = getThreadBrowseData(fixture.dbPath, fallbackThreadId);
        const scopedThreads = listScopedThreads(fixture.dbPath, 'spiracha');

        expect(threads.map((thread) => thread.thread.id)).toContain(fallbackThreadId);
        expect(threads[0]).toMatchObject({
            project: 'spiracha',
            thread: {
                cwd: '/Users/user/workspace/spiracha',
                id: fallbackThreadId,
                model: 'gpt-5.5',
                rollout_path: fallbackSessionFile,
                title: 'Map pipeline unknowns',
                tokens_used: 123456,
            },
        });
        expect(projects.find((project) => project.name === 'spiracha')?.threadCount).toBe(3);
        expect(dashboard.recentThreads[0]).toMatchObject({
            project: 'spiracha',
            thread: {
                id: fallbackThreadId,
                model: 'gpt-5.5',
                title: 'Map pipeline unknowns',
                tokens_used: 123456,
            },
        });
        expect(fallbackDetails).toMatchObject({
            dynamicTools: [
                {
                    deferLoading: true,
                    description: 'Run a command.',
                    inputSchema: { properties: { cmd: { type: 'string' } }, type: 'object' },
                    name: 'exec_command',
                    namespace: 'codex',
                    position: 0,
                    threadId: fallbackThreadId,
                },
            ],
            project: 'spiracha',
            relations: {
                childEdges: [],
                parentThreadId: null,
            },
            thread: {
                id: fallbackThreadId,
                model: 'gpt-5.5',
                title: 'Map pipeline unknowns',
                tokens_used: 123456,
            },
        });
        expect(scopedThreads.map((thread) => thread.id)).toContain(fallbackThreadId);
    });

    it('should read fallback rollout stats without allocating the whole file', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-large-rollout-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const fallbackThreadId = '019ec3d5-859d-77d0-b851-256ae567ff63';
        const fallbackSessionFile = path.join(
            tempRoot,
            'sessions',
            '2026',
            '06',
            '13',
            `rollout-2026-06-13T21-53-31-${fallbackThreadId}.jsonl`,
        );

        await mkdir(path.dirname(fallbackSessionFile), { recursive: true });
        await Bun.write(
            fallbackSessionFile,
            [
                {
                    payload: {
                        cli_version: '0.140.0-alpha.2',
                        cwd: '/Users/user/workspace/spiracha',
                        id: fallbackThreadId,
                        model_provider: 'openai',
                        originator: 'Codex Desktop',
                        source: 'vscode',
                        thread_source: 'user',
                        timestamp: '2026-06-14T01:53:31.047Z',
                    },
                    timestamp: '2026-06-14T01:57:28.908Z',
                    type: 'session_meta',
                },
                {
                    payload: {
                        message: 'x'.repeat(400 * 1024),
                    },
                    timestamp: '2026-06-14T01:57:29.000Z',
                    type: 'event_msg',
                },
                {
                    payload: {
                        model: 'gpt-5.5',
                        padding: 'y'.repeat(300 * 1024),
                        turn_id: 'turn-1',
                    },
                    timestamp: '2026-06-14T01:57:30.000Z',
                    type: 'turn_context',
                },
                {
                    payload: {
                        info: {
                            total_token_usage: {
                                total_tokens: 789,
                            },
                        },
                        type: 'token_count',
                    },
                    timestamp: '2026-06-14T01:57:31.000Z',
                    type: 'event_msg',
                },
            ]
                .map((entry) => JSON.stringify(entry))
                .join('\n'),
        );
        await Bun.write(
            path.join(tempRoot, 'session_index.jsonl'),
            JSON.stringify({
                id: fallbackThreadId,
                thread_name: 'Large rollout stats',
                updated_at: '2026-06-14T01:57:34.149424Z',
            }),
        );

        const threads = await listProjectThreads(fixture.dbPath, 'spiracha');
        const fallbackThread = threads.find((thread) => thread.thread.id === fallbackThreadId);

        expect(fallbackThread?.thread.model).toBe('gpt-5.5');
        expect(fallbackThread?.thread.tokens_used).toBe(789);
    });

    it('should omit fallback threads whose ID resolves to multiple rollout files', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-ambiguous-fallback-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const fallbackThreadId = '019ec3d5-859d-77d0-b851-256ae567ff69';
        const sessionRecord = JSON.stringify({
            payload: {
                cwd: '/Users/user/workspace/spiracha',
                id: fallbackThreadId,
                timestamp: '2026-06-14T01:53:31.047Z',
            },
            type: 'session_meta',
        });
        const sessionPaths = ['13', '14'].map((day) =>
            path.join(
                tempRoot,
                'sessions',
                '2026',
                '06',
                day,
                `rollout-2026-06-${day}T21-53-31-${fallbackThreadId}.jsonl`,
            ),
        );
        for (const sessionPath of sessionPaths) {
            await mkdir(path.dirname(sessionPath), { recursive: true });
            await Bun.write(sessionPath, sessionRecord);
        }
        await Bun.write(
            path.join(tempRoot, 'session_index.jsonl'),
            JSON.stringify({ id: fallbackThreadId, thread_name: 'Ambiguous fallback thread' }),
        );

        const threads = await listProjectThreads(fixture.dbPath, 'spiracha', { includeTranscriptStats: false });

        expect(threads.map((thread) => thread.thread.id)).not.toContain(fallbackThreadId);
        expect(() => getThreadBrowseData(fixture.dbPath, fallbackThreadId)).toThrow('Thread not found');
    });

    it('should summarize fallback projects without parsing large irrelevant rollout records', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-fallback-summary-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const fallbackThreadId = '019ec3d5-859d-77d0-b851-256ae567ff64';
        const fallbackSessionFile = path.join(
            tempRoot,
            'sessions',
            '2026',
            '06',
            '13',
            `rollout-2026-06-13T21-53-31-${fallbackThreadId}.jsonl`,
        );

        await mkdir(path.dirname(fallbackSessionFile), { recursive: true });
        await Bun.write(
            fallbackSessionFile,
            [
                {
                    payload: {
                        cli_version: '0.140.0-alpha.2',
                        cwd: '/Users/user/workspace/spiracha',
                        id: fallbackThreadId,
                        model_provider: 'openai',
                        source: 'vscode',
                        thread_source: 'user',
                        timestamp: '2026-06-14T01:53:31.047Z',
                    },
                    timestamp: '2026-06-14T01:57:28.908Z',
                    type: 'session_meta',
                },
                {
                    payload: {
                        message: `expensive-middle-${'x'.repeat(6 * 1024 * 1024)}`,
                    },
                    timestamp: '2026-06-14T01:57:29.000Z',
                    type: 'event_msg',
                },
                {
                    payload: {
                        model: 'gpt-5.5',
                        turn_id: 'turn-1',
                    },
                    timestamp: '2026-06-14T01:57:30.000Z',
                    type: 'turn_context',
                },
                {
                    payload: {
                        info: {
                            total_token_usage: {
                                total_tokens: 321,
                            },
                        },
                        type: 'token_count',
                    },
                    timestamp: '2026-06-14T01:57:31.000Z',
                    type: 'event_msg',
                },
            ]
                .map((entry) => JSON.stringify(entry))
                .join('\n'),
        );
        await Bun.write(
            path.join(tempRoot, 'session_index.jsonl'),
            JSON.stringify({
                id: fallbackThreadId,
                thread_name: 'Large summary rollout',
                updated_at: '2026-06-14T01:57:34.149424Z',
            }),
        );

        const firstProjects = await listCodexProjects(fixture.dbPath);
        const projects = await listCodexProjects(fixture.dbPath);
        const project = projects.find((candidate) => candidate.name === 'spiracha');

        expect(projects).toEqual(firstProjects);
        expect(project?.threadCount).toBe(3);
        expect(project?.totalTokens).toBe(641112);
        expect(project?.modelNames).toContain('gpt-5.5');
    });

    it('should sort fallback project threads by rollout activity and omit fallback subagents', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-fallback-order-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const completeThreadId = '019ec3a1-fc8f-7b40-8ee7-c6e306285183';
        const mapThreadId = '019ec3d5-859d-77d0-b851-256ae567ff62';
        const subagentThreadId = '019ec3da-6988-77a2-ba22-5778525ce583';
        const sessionRoot = path.join(tempRoot, 'sessions', '2026', '06', '13');
        const completeSessionFile = path.join(sessionRoot, `rollout-2026-06-13T20-57-13-${completeThreadId}.jsonl`);
        const mapSessionFile = path.join(sessionRoot, `rollout-2026-06-13T21-53-31-${mapThreadId}.jsonl`);
        const subagentSessionFile = path.join(sessionRoot, `rollout-2026-06-13T21-58-51-${subagentThreadId}.jsonl`);
        const writeSessionMeta = async (
            sessionFile: string,
            payload: {
                id: string;
                parent_thread_id?: string;
                source?: unknown;
                thread_source: string;
                timestamp: string;
            },
        ) => {
            await mkdir(path.dirname(sessionFile), { recursive: true });
            await Bun.write(
                sessionFile,
                JSON.stringify({
                    payload: {
                        cli_version: '0.140.0-alpha.2',
                        cwd: '/Users/user/workspace/ushman',
                        model_provider: 'openai',
                        originator: 'Codex Desktop',
                        source: 'vscode',
                        ...payload,
                    },
                    timestamp: payload.timestamp,
                    type: 'session_meta',
                }),
            );
        };

        await writeSessionMeta(completeSessionFile, {
            id: completeThreadId,
            thread_source: 'user',
            timestamp: '2026-06-14T00:57:13.625Z',
        });
        await writeSessionMeta(mapSessionFile, {
            id: mapThreadId,
            thread_source: 'user',
            timestamp: '2026-06-14T01:53:31.047Z',
        });
        await writeSessionMeta(subagentSessionFile, {
            id: subagentThreadId,
            parent_thread_id: mapThreadId,
            source: {
                subagent: {
                    thread_spawn: {
                        parent_thread_id: mapThreadId,
                    },
                },
            },
            thread_source: 'subagent',
            timestamp: '2026-06-14T01:58:51.539Z',
        });
        await Bun.write(
            path.join(tempRoot, 'session_index.jsonl'),
            [
                {
                    id: completeThreadId,
                    thread_name: 'Complete issue 882 E2E',
                    updated_at: '2026-06-14T00:58:30.235114Z',
                },
                {
                    id: mapThreadId,
                    thread_name: 'Map pipeline unknowns',
                    updated_at: '2026-06-14T01:57:34.149424Z',
                },
                {
                    id: subagentThreadId,
                    thread_name: 'Update research prompt gaps',
                    updated_at: '2026-06-14T01:58:57.225462Z',
                },
            ]
                .map((entry) => JSON.stringify(entry))
                .join('\n'),
        );
        await utimes(completeSessionFile, new Date('2026-06-14T02:10:00.000Z'), new Date('2026-06-14T02:10:00.000Z'));
        await utimes(mapSessionFile, new Date('2026-06-14T01:57:00.000Z'), new Date('2026-06-14T01:57:00.000Z'));
        await utimes(subagentSessionFile, new Date('2026-06-14T01:58:00.000Z'), new Date('2026-06-14T01:58:00.000Z'));

        const threads = await listProjectThreads(fixture.dbPath, 'ushman');

        expect(threads.map((thread) => thread.thread.title)).toEqual([
            'Complete issue 882 E2E',
            'Map pipeline unknowns',
        ]);
    });

    it('should return project thread rows sorted by update time and include browse metadata', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-threads-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const db = new Database(fixture.dbPath);
        db.query(
            'INSERT INTO thread_goals (thread_id, goal_id, objective, status, token_budget, tokens_used, time_used_seconds, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
            fixture.threads[0]!.threadId,
            'goal-1',
            'Ship the thread tools view',
            'in_progress',
            20_000,
            3_400,
            125,
            1_779_036_500_000,
            1_779_037_900_000,
        );
        db.close();

        const threads = await listProjectThreads(fixture.dbPath, 'spiracha');
        const threadDetails = getThreadBrowseData(fixture.dbPath, fixture.threads[0]!.threadId);

        expect(threads).toHaveLength(2);
        expect(threads.map((thread) => thread.thread.id)).toEqual([
            fixture.threads[0]!.threadId,
            fixture.threads[1]!.threadId,
        ]);
        expect(threadDetails.dynamicTools).toHaveLength(2);
        expect(threadDetails.goals).toEqual([
            {
                createdAtMs: 1_779_036_500_000,
                goalId: 'goal-1',
                objective: 'Ship the thread tools view',
                status: 'in_progress',
                timeUsedSeconds: 125,
                tokenBudget: 20_000,
                tokensUsed: 3_400,
                updatedAtMs: 1_779_037_900_000,
            },
        ]);
        expect(threadDetails.relations.childEdges).toHaveLength(1);
        expect(threadDetails.thread.preview).toBe('Build the Spiracha UI');
        expect(threads[0]?.stats.deferred).toBe(false);
        expect(threads[0]?.rolloutSizeBytes).toBeGreaterThan(0);
    });

    it('should give metadata-only subagent threads a navigable display title and preview', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-subagent-title-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const threadId = fixture.threads[0]!.threadId;
        const anonymousThreadId = fixture.threads[1]!.threadId;
        const db = new Database(fixture.dbPath);
        db.query(
            `UPDATE threads
             SET title = '', first_user_message = '', preview = '', thread_source = 'subagent',
                 agent_nickname = 'Halley', agent_path = '/root/code_review'
             WHERE id = ?`,
        ).run(threadId);
        db.query(
            `UPDATE threads
             SET title = '', first_user_message = '', preview = '', thread_source = 'subagent',
                 agent_nickname = NULL, agent_path = NULL
             WHERE id = ?`,
        ).run(anonymousThreadId);
        db.close();

        const listedThreads = await listProjectThreads(fixture.dbPath, 'spiracha');
        const listedThread = listedThreads.find((entry) => entry.thread.id === threadId);
        const anonymousThread = listedThreads.find((entry) => entry.thread.id === anonymousThreadId);
        const detail = getThreadBrowseData(fixture.dbPath, threadId);

        expect(listedThread?.thread.title).toBe('Halley (subagent)');
        expect(listedThread?.thread.preview).toBe('Agent path: /root/code_review');
        expect(anonymousThread?.thread.title).toBe('Untitled Codex thread');
        expect(anonymousThread?.thread.preview).toBe('No transcript preview available.');
        expect(detail.thread.title).toBe('Halley (subagent)');
        expect(detail.thread.preview).toBe('Agent path: /root/code_review');
    });

    it('should tolerate browse reads on schemas without optional relation or tool tables', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-minimal-browse-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createMinimalBrowseSchemaFixture(tempRoot);

        const threadDetails = getThreadBrowseData(fixture.dbPath, fixture.threadId);

        expect(threadDetails.dynamicTools).toEqual([]);
        expect(threadDetails.goals).toEqual([]);
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

    it('should defer transcript stats for fast project thread lists when requested', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-fast-thread-list-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const originalParse = JSON.parse;
        let parsedRolloutRecords = 0;
        JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
            if (text.includes('"type":"session_meta"') || text.includes('"type":"event_msg"')) {
                parsedRolloutRecords += 1;
            }

            return originalParse(text, reviver);
        }) as typeof JSON.parse;

        try {
            const threads = await listProjectThreads(fixture.dbPath, 'spiracha', {
                includeTranscriptStats: false,
            });

            expect(threads).toHaveLength(2);
            expect(threads[0]?.stats).toMatchObject({
                deferred: true,
                execCommandCount: 0,
                toolCallCount: 0,
                webSearchEventCount: 0,
            });
            expect(parsedRolloutRecords).toBe(0);
        } finally {
            JSON.parse = originalParse;
        }
    });

    it('should keep project thread lists usable when a rollout file is missing', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-missing-rollout-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const missingThread = fixture.threads[0]!;

        await rm(missingThread.sessionFile, { force: true });

        const threads = await listProjectThreads(fixture.dbPath, missingThread.project);
        const staleThread = threads.find((thread) => thread.thread.id === missingThread.threadId);

        expect(staleThread).toMatchObject({
            rolloutSizeBytes: null,
            stats: {
                deferred: false,
                execCommandCount: 0,
                toolCallCount: 0,
                webSearchEventCount: 0,
            },
            thread: {
                id: missingThread.threadId,
            },
        });
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

    it('should bulk-delete unique Codex thread ids and preserve rollout files by default', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-delete-threads-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const threadIds = fixture.threads.map((thread) => thread.threadId);

        const result = await deleteCodexThreads(fixture.dbPath, [...threadIds, threadIds[0]!]);

        expect(result.deletedThreadIds.sort()).toEqual([...threadIds].sort());
        expect(result.deletedSessionFiles).toEqual([]);
        expect(await Promise.all(fixture.threads.map((thread) => Bun.file(thread.sessionFile).exists()))).toEqual(
            fixture.threads.map(() => true),
        );
        const db = new Database(fixture.dbPath, { readonly: true });
        expect(db.query('SELECT COUNT(*) AS count FROM threads').get()).toEqual({ count: 0 });
        db.close();
    });

    it('should resolve the configured Codex thread database path', () => {
        const previous = process.env.SPIRACHA_CODEX_DB;
        const configuredPath = path.join(os.tmpdir(), 'configured-codex-state.sqlite');
        process.env.SPIRACHA_CODEX_DB = `  ${configuredPath}  `;
        try {
            expect(resolveCodexThreadDbPath()).toBe(configuredPath);
        } finally {
            if (previous === undefined) {
                delete process.env.SPIRACHA_CODEX_DB;
            } else {
                process.env.SPIRACHA_CODEX_DB = previous;
            }
        }
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

    it('should reject an out-of-tree rollout path before deleting thread data', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-unsafe-rollout-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const threadId = fixture.threads[0]!.threadId;
        const externalFile = path.join(path.dirname(tempRoot), `${path.basename(tempRoot)}-external.jsonl`);
        tempPaths.push(externalFile);
        await Bun.write(externalFile, 'do not delete');

        const db = new Database(fixture.dbPath);
        db.query('UPDATE threads SET rollout_path = ? WHERE id = ?').run(externalFile, threadId);
        db.close();

        await expect(deleteCodexThread(fixture.dbPath, threadId, { deleteSessionFiles: true })).rejects.toThrow(
            'Unsafe Codex rollout path',
        );
        expect(await Bun.file(externalFile).exists()).toBe(true);

        const verificationDb = new Database(fixture.dbPath, { readonly: true });
        expect(verificationDb.query('SELECT COUNT(*) AS count FROM threads WHERE id = ?').get(threadId)).toEqual({
            count: 1,
        });
        verificationDb.close();
    });

    it('should keep a deleted DB thread from reappearing through the fallback session index', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-delete-thread-index-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const threadId = fixture.threads[0]!.threadId;
        const sessionFile = fixture.threads[0]!.sessionFile;

        await Bun.write(
            path.join(tempRoot, 'session_index.jsonl'),
            JSON.stringify({
                id: threadId,
                thread_name: fixture.threads[0]!.title,
                updated_at: '2026-06-14T01:57:34.149424Z',
            }),
        );

        const result = await deleteCodexThread(fixture.dbPath, threadId);

        expect(result.deletedThreadIds).toEqual([threadId]);
        expect(result.deletedSessionFiles).toEqual([]);
        expect(await Bun.file(sessionFile).exists()).toBe(true);
        expect(() => getThreadBrowseData(fixture.dbPath, threadId)).toThrow('Thread not found');
        expect(() => getThreadBrowseData(fixture.dbPath, threadId)).toThrow(CodexThreadNotFoundError);
    });

    it('should delete fallback-only threads from the session index and disk', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-delete-fallback-thread-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const fallbackThreadId = '019ec3d5-859d-77d0-b851-256ae567ff65';
        const fallbackSessionFile = path.join(
            tempRoot,
            'sessions',
            '2026',
            '06',
            '13',
            `rollout-2026-06-13T21-53-31-${fallbackThreadId}.jsonl`,
        );

        await mkdir(path.dirname(fallbackSessionFile), { recursive: true });
        await Bun.write(
            fallbackSessionFile,
            [
                {
                    payload: {
                        cli_version: '0.140.0-alpha.2',
                        cwd: '/Users/user/workspace/spiracha',
                        id: fallbackThreadId,
                        model_provider: 'openai',
                        source: 'vscode',
                        thread_source: 'user',
                        timestamp: '2026-06-14T01:53:31.047Z',
                    },
                    timestamp: '2026-06-14T01:57:28.908Z',
                    type: 'session_meta',
                },
                {
                    payload: {
                        info: {
                            total_token_usage: {
                                total_tokens: 456,
                            },
                        },
                        type: 'token_count',
                    },
                    timestamp: '2026-06-14T01:57:31.000Z',
                    type: 'event_msg',
                },
            ]
                .map((entry) => JSON.stringify(entry))
                .join('\n'),
        );
        const sessionIndexPath = path.join(tempRoot, 'session_index.jsonl');
        await Bun.write(
            sessionIndexPath,
            [
                {
                    id: fallbackThreadId,
                    thread_name: 'Delete fallback thread',
                    updated_at: '2026-06-14T01:57:34.149424Z',
                },
                {
                    id: '019ec3d5-859d-77d0-b851-256ae567ff66',
                    thread_name: 'Retained fallback thread',
                    updated_at: '2026-06-14T01:58:34.149424Z',
                },
            ]
                .map((entry) => JSON.stringify(entry))
                .join('\n'),
        );

        const result = await deleteCodexThread(fixture.dbPath, fallbackThreadId, {
            deleteSessionFiles: true,
        });

        expect(result.deletedThreadIds).toEqual([fallbackThreadId]);
        expect(result.deletedSessionFiles).toEqual([fallbackSessionFile]);
        expect(await Bun.file(fallbackSessionFile).exists()).toBe(false);
        expect(await Bun.file(sessionIndexPath).text()).toBe(
            `${JSON.stringify({
                id: '019ec3d5-859d-77d0-b851-256ae567ff66',
                thread_name: 'Retained fallback thread',
                updated_at: '2026-06-14T01:58:34.149424Z',
            })}\n`,
        );
        expect(() => getThreadBrowseData(fixture.dbPath, fallbackThreadId)).toThrow('Thread not found');
    });

    it('should delete all threads that match a derived project basename', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-delete-project-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);

        const result = await deleteCodexProject(fixture.dbPath, 'spiracha');
        const summary = await getCodexDashboardSummary(fixture.dbPath);

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

        const summary = await getCodexDashboardSummary(fixture.dbPath);

        expect(summary.recentThreads[0]).toMatchObject({
            project: 'spiracha',
            thread: {
                id: fixture.threads[0]!.threadId,
            },
        });
    });

    it('should use rollout file activity when dashboard thread timestamps are stale', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-dashboard-rollout-activity-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const staleThread = fixture.threads[1]!;
        const rolloutUpdatedAt = new Date('2030-11-20T17:46:39.999Z');

        await utimes(staleThread.sessionFile, rolloutUpdatedAt, rolloutUpdatedAt);

        const summary = await getCodexDashboardSummary(fixture.dbPath);

        expect(summary.recentThreads[0]).toMatchObject({
            project: staleThread.project,
            thread: {
                id: staleThread.threadId,
                updated_at_ms: rolloutUpdatedAt.getTime(),
            },
        });
    });

    it('should list the most recently active rollout once per project', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-dashboard-project-activity-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const newerSpirachaThread = fixture.threads.filter((thread) => thread.project === 'spiracha')[1]!;
        const shibukThread = fixture.threads.find((thread) => thread.project === 'shibuk')!;

        await utimes(
            shibukThread.sessionFile,
            new Date('2030-11-20T17:46:30.000Z'),
            new Date('2030-11-20T17:46:30.000Z'),
        );
        await utimes(
            newerSpirachaThread.sessionFile,
            new Date('2030-11-20T17:46:39.000Z'),
            new Date('2030-11-20T17:46:39.000Z'),
        );

        const summary = await getCodexDashboardSummary(fixture.dbPath);

        expect(summary.recentThreads.map((entry) => entry.project).slice(0, 2)).toEqual(['spiracha', 'shibuk']);
        expect(summary.recentThreads.filter((entry) => entry.project === 'spiracha')).toHaveLength(1);
        expect(summary.recentThreads[0]?.thread.id).toBe(newerSpirachaThread.threadId);
    });

    it('should omit recent dashboard threads without a portable project key', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-browser-db-dashboard-recent-project-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexBrowserFixture(tempRoot);
        const db = new Database(fixture.dbPath);
        try {
            const { latestUpdatedAtMs } = db
                .query<{ latestUpdatedAtMs: number }, []>(
                    'SELECT MAX(COALESCE(updated_at_ms, updated_at * 1000)) AS latestUpdatedAtMs FROM threads',
                )
                .get() ?? { latestUpdatedAtMs: 0 };
            const insertThread = db.prepare(`
                INSERT INTO threads (
                    id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
                    sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version,
                    first_user_message, memory_mode, model, created_at_ms, updated_at_ms, preview
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const index of [0, 1, 2, 3, 4, 5]) {
                const hasPortableProject = index >= 3;
                const updatedAtMs = latestUpdatedAtMs + 10_000 - index;
                insertThread.run(
                    `recent-${index}`,
                    path.join(tempRoot, 'sessions', `recent-${index}.jsonl`),
                    Math.floor(updatedAtMs / 1000),
                    Math.floor(updatedAtMs / 1000),
                    'vscode',
                    'openai',
                    hasPortableProject ? `/Users/user/workspace/recent-${index}` : '',
                    `Recent ${index}`,
                    '{"type":"danger-full-access"}',
                    'never',
                    10,
                    1,
                    0,
                    '0.1.0',
                    `Prompt ${index}`,
                    'enabled',
                    'gpt-5.5',
                    updatedAtMs,
                    updatedAtMs,
                    `Prompt ${index}`,
                );
            }
        } finally {
            db.close();
        }

        const summary = await getCodexDashboardSummary(fixture.dbPath);
        const recentThreadIds = summary.recentThreads.map((entry) => entry.thread.id);

        expect(recentThreadIds).not.toContain('recent-0');
        expect(recentThreadIds).not.toContain('recent-1');
        expect(recentThreadIds).not.toContain('recent-2');
        expect(recentThreadIds).toContain('recent-5');
        expect(summary.recentThreads.every((entry) => entry.project.length > 0)).toBe(true);
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
