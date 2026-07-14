import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteOpenCodeDesktopSessionState,
    deleteOpenCodeSession,
    findOpenCodeWorkspaceGroups,
    getDefaultOpenCodeDataDir,
    getOpenCodeReadDbUri,
    listOpenCodeSessionsForGroup,
    listOpenCodeWorkspaceGroups,
    openOpenCodeReadDb,
    readOpenCodeSessionTranscript,
    resolveOpenCodeDbConcurrency,
} from './opencode-db';
import { createOpenCodeFixture } from './opencode-test-helpers';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const makeDbPath = async (): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'opencode-fixture-'));
    tempDirs.push(dir);
    return path.join(dir, 'opencode.db');
};

const createFixtureDb = async () => {
    const dbPath = await makeDbPath();
    await createOpenCodeFixture(dbPath, {
        projects: [
            {
                id: 'pro_demo',
                name: null,
                timeUpdated: 1_700_000_000_000,
                worktree: '/Users/test/workspace/demo',
            },
        ],
        sessions: [
            {
                agent: 'build',
                cost: 0.42,
                id: 'ses_main',
                messages: [
                    {
                        id: 'msg_user',
                        parts: [
                            {
                                data: { text: 'Review Descope-Class Vendor-Detection fixtures', type: 'text' },
                                id: 'prt_user_text',
                            },
                        ],
                        role: 'user',
                        timeCreated: 1_700_000_000_100,
                    },
                    {
                        id: 'msg_assistant',
                        parts: [
                            {
                                data: { text: 'I need to inspect the fixtures.', type: 'reasoning' },
                                id: 'prt_reasoning',
                                timeCreated: 1_700_000_000_200,
                            },
                            {
                                data: { snapshot: 'abc123', type: 'step-start' },
                                id: 'prt_step_start',
                                timeCreated: 1_700_000_000_250,
                            },
                            {
                                data: {
                                    callID: 'call_read',
                                    state: {
                                        input: { filePath: '/Users/test/workspace/demo/AGENTS.md' },
                                        output: 'file contents',
                                        status: 'completed',
                                        title: 'Read AGENTS',
                                    },
                                    tool: 'read',
                                    type: 'tool',
                                },
                                id: 'prt_tool',
                                timeCreated: 1_700_000_000_300,
                            },
                            {
                                data: {
                                    reason: 'stop',
                                    snapshot: 'abc123',
                                    tokens: {
                                        cache: { read: 3, write: 4 },
                                        input: 10,
                                        output: 5,
                                        reasoning: 2,
                                        total: 20,
                                    },
                                    type: 'step-finish',
                                },
                                id: 'prt_step_finish',
                                timeCreated: 1_700_000_000_350,
                            },
                            {
                                data: { text: 'The fixture review is complete.', type: 'text' },
                                id: 'prt_assistant_text',
                                timeCreated: 1_700_000_000_400,
                            },
                        ],
                        role: 'assistant',
                        timeCreated: 1_700_000_000_200,
                    },
                ],
                model: { id: 'gpt-5-codex', providerID: 'opencode', variant: 'high' },
                projectId: 'pro_demo',
                slug: 'quiet-mountain',
                summaryFiles: 2,
                timeCreated: 1_700_000_000_000,
                timeUpdated: 1_700_000_100_000,
                title: 'Comprehensive code review',
                tokensInput: 10,
                tokensOutput: 5,
                tokensReasoning: 2,
            },
            {
                id: 'ses_child',
                messages: [],
                parentId: 'ses_main',
                projectId: 'pro_demo',
                timeUpdated: 1_700_000_200_000,
                title: 'Subagent session',
            },
        ],
    });
    return dbPath;
};

describe('opencode db helpers', () => {
    it('should resolve the default XDG data directory', () => {
        expect(getDefaultOpenCodeDataDir({}, '/Users/alice')).toBe('/Users/alice/.local/share/opencode');
        expect(getDefaultOpenCodeDataDir({ XDG_DATA_HOME: '/tmp/xdg' }, '/Users/alice')).toBe('/tmp/xdg/opencode');
    });

    it('should build a read SQLite URI for paths with spaces', () => {
        expect(getOpenCodeReadDbUri('/Users/alice/Local Data/opencode.db')).toBe(
            'file:///Users/alice/Local%20Data/opencode.db?mode=rw',
        );
    });

    it('should resolve tunable OpenCode database concurrency', () => {
        expect(resolveOpenCodeDbConcurrency('4')).toBe(4);
        expect(resolveOpenCodeDbConcurrency('0')).toBe(2);
        expect(resolveOpenCodeDbConcurrency('invalid')).toBe(2);
    });

    it('should group top-level sessions by project workspace', async () => {
        const dbPath = await createFixtureDb();

        const groups = await listOpenCodeWorkspaceGroups(dbPath);

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            key: 'project:pro_demo',
            label: 'demo',
            lastActiveMs: 1_700_000_100_000,
            sessionCount: 1,
            worktree: '/Users/test/workspace/demo',
        });
        expect(groups[0]?.messageCount).toBe(2);
        expect(groups[0]?.partCount).toBe(6);
    });

    it('should read a WAL database when its sidecar files do not exist', async () => {
        const dbPath = await createFixtureDb();
        const db = new Database(dbPath);
        db.exec('PRAGMA journal_mode = WAL');
        db.close();
        expect(await Bun.file(`${dbPath}-shm`).exists()).toBe(false);
        expect(await Bun.file(`${dbPath}-wal`).exists()).toBe(false);

        const groups = await listOpenCodeWorkspaceGroups(dbPath);

        expect(groups).toHaveLength(1);
        expect(groups[0]?.key).toBe('project:pro_demo');
    });

    it('should prevent writes through an OpenCode read connection', async () => {
        const dbPath = await createFixtureDb();
        const db = openOpenCodeReadDb(dbPath);

        try {
            expect(() => db.exec("UPDATE project SET name = 'changed' WHERE id = 'pro_demo'")).toThrow(
                'attempt to write a readonly database',
            );
        } finally {
            db.close();
        }
    });

    it('should encode workspace file URIs for paths with spaces', async () => {
        const dbPath = await makeDbPath();
        await createOpenCodeFixture(dbPath, {
            projects: [
                {
                    id: 'pro_spaced',
                    timeUpdated: 1_700_000_000_000,
                    worktree: '/Users/test/workspace/demo project',
                },
            ],
            sessions: [
                {
                    id: 'ses_spaced',
                    messages: [],
                    projectId: 'pro_spaced',
                    timeUpdated: 1_700_000_000_000,
                    title: 'Spaced path',
                },
            ],
        });

        const groups = await listOpenCodeWorkspaceGroups(dbPath);

        expect(groups[0]?.uri).toBe('file:///Users/test/workspace/demo%20project');
    });

    it('should match workspaces by basename or path query', async () => {
        const dbPath = await createFixtureDb();
        const groups = await listOpenCodeWorkspaceGroups(dbPath);

        expect(findOpenCodeWorkspaceGroups(groups, 'demo')).toHaveLength(1);
        expect(findOpenCodeWorkspaceGroups(groups, '/Users/test/workspace/demo')).toHaveLength(1);
    });

    it('should list top-level sessions for a workspace', async () => {
        const dbPath = await createFixtureDb();

        const sessions = await listOpenCodeSessionsForGroup('project:pro_demo', dbPath);

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            agent: 'build',
            messageCount: 2,
            modelLabel: 'gpt-5-codex high',
            partCount: 6,
            renderablePartCount: 4,
            sessionId: 'ses_main',
            title: 'Comprehensive code review',
            toolPartCount: 1,
            workspaceLabel: 'demo',
        });
    });

    it('should surface an unopenable OpenCode db path instead of reporting empty history', async () => {
        const dbPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'opencode-unopenable-')), 'opencode.db');
        tempDirs.push(path.dirname(dbPath));
        await mkdir(dbPath);

        await expect(listOpenCodeWorkspaceGroups(dbPath)).rejects.toThrow(/SQLite operation failed/u);
    });

    it('should read a session transcript with parsed parts in message order', async () => {
        const dbPath = await createFixtureDb();

        const transcript = await readOpenCodeSessionTranscript(dbPath, 'ses_main');

        expect(transcript?.session.sessionId).toBe('ses_main');
        expect(transcript?.messages).toHaveLength(2);
        expect(transcript?.renderablePartCount).toBe(4);
        expect(transcript?.messages[1]?.parts.map((part) => part.type)).toEqual([
            'reasoning',
            'step-start',
            'tool',
            'step-finish',
            'text',
        ]);
        expect(transcript?.messages[1]?.parts[2]).toMatchObject({
            callId: 'call_read',
            outputText: 'file contents',
            status: 'completed',
            toolName: 'read',
            type: 'tool',
        });
    });

    it('should delete an OpenCode top-level session with child sessions and transcript rows', async () => {
        const dbPath = await createFixtureDb();
        const setupDb = new Database(dbPath);
        try {
            setupDb.exec(`
                CREATE TABLE event_sequence (
                    aggregate_id TEXT PRIMARY KEY,
                    seq INTEGER NOT NULL,
                    owner_id TEXT
                );
                CREATE TABLE event (
                    id TEXT PRIMARY KEY,
                    aggregate_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    data TEXT NOT NULL
                );
                CREATE TABLE session_context_epoch (
                    session_id TEXT PRIMARY KEY,
                    baseline TEXT NOT NULL,
                    snapshot TEXT NOT NULL,
                    baseline_seq INTEGER NOT NULL
                );
                CREATE TABLE session_input (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    delivery TEXT NOT NULL,
                    admitted_seq INTEGER NOT NULL,
                    promoted_seq INTEGER,
                    time_created INTEGER NOT NULL
                );
                CREATE TABLE session_message (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    time_created INTEGER NOT NULL,
                    time_updated INTEGER NOT NULL,
                    data TEXT NOT NULL
                );
                CREATE TABLE session_share (
                    session_id TEXT PRIMARY KEY,
                    id TEXT NOT NULL,
                    secret TEXT NOT NULL,
                    url TEXT NOT NULL,
                    time_created INTEGER NOT NULL,
                    time_updated INTEGER NOT NULL
                );
                CREATE TABLE todo (
                    session_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL,
                    priority TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    time_created INTEGER NOT NULL,
                    time_updated INTEGER NOT NULL,
                    PRIMARY KEY (session_id, position)
                );
            `);
            setupDb.run('INSERT INTO event_sequence (aggregate_id, seq, owner_id) VALUES (?, 1, NULL)', ['ses_main']);
            setupDb.run('INSERT INTO event_sequence (aggregate_id, seq, owner_id) VALUES (?, 1, NULL)', ['ses_child']);
            setupDb.run('INSERT INTO event_sequence (aggregate_id, seq, owner_id) VALUES (?, 1, NULL)', [
                'evt_retained',
            ]);
            setupDb.run('INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, 1, ?, ?)', [
                'evt_main',
                'ses_main',
                'message.updated',
                '{}',
            ]);
            setupDb.run('INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, 1, ?, ?)', [
                'evt_child',
                'ses_child',
                'message.updated',
                '{}',
            ]);
            setupDb.run('INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, 1, ?, ?)', [
                'evt_keep',
                'evt_retained',
                'other.updated',
                '{}',
            ]);
            setupDb.run(
                'INSERT INTO session_context_epoch (session_id, baseline, snapshot, baseline_seq) VALUES (?, ?, ?, ?)',
                ['ses_main', '{}', '{}', 1],
            );
            setupDb.run(
                'INSERT INTO session_input (id, session_id, prompt, delivery, admitted_seq, promoted_seq, time_created) VALUES (?, ?, ?, ?, ?, NULL, ?)',
                ['input_main', 'ses_main', 'prompt', 'manual', 1, 1],
            );
            setupDb.run(
                'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
                ['sm_main', 'ses_main', 'message', 1, 1, 1, '{}'],
            );
            setupDb.run(
                'INSERT INTO session_share (session_id, id, secret, url, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)',
                ['ses_main', 'share_main', 'secret', 'https://example.test/share', 1, 1],
            );
            setupDb.run(
                'INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
                ['ses_main', 'todo', 'pending', 'low', 1, 1, 1],
            );
        } finally {
            setupDb.close();
        }

        const result = await deleteOpenCodeSession(dbPath, 'ses_main');

        expect(result.deletedSessionIds.sort()).toEqual(['ses_child', 'ses_main']);
        expect(await listOpenCodeSessionsForGroup('project:pro_demo', dbPath)).toEqual([]);
        expect(await readOpenCodeSessionTranscript(dbPath, 'ses_main')).toBeNull();

        const db = new Database(dbPath);
        try {
            expect(db.query('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 0 });
            expect(db.query('SELECT COUNT(*) AS count FROM message').get()).toEqual({ count: 0 });
            expect(db.query('SELECT COUNT(*) AS count FROM part').get()).toEqual({ count: 0 });
            expect(
                db.query('SELECT COUNT(*) AS count FROM event_sequence WHERE aggregate_id LIKE ?').get('ses_%'),
            ).toEqual({ count: 0 });
            expect(db.query('SELECT COUNT(*) AS count FROM event WHERE aggregate_id LIKE ?').get('ses_%')).toEqual({
                count: 0,
            });
            expect(
                db.query('SELECT COUNT(*) AS count FROM event_sequence WHERE aggregate_id = ?').get('evt_retained'),
            ).toEqual({ count: 1 });
            for (const tableName of [
                'session_context_epoch',
                'session_input',
                'session_message',
                'session_share',
                'todo',
            ]) {
                expect(db.query(`SELECT COUNT(*) AS count FROM ${tableName}`).get()).toEqual({ count: 0 });
            }
        } finally {
            db.close();
        }
    });

    it('should delete OpenCode Desktop state for removed sessions', async () => {
        const stateDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-desktop-state-'));
        tempDirs.push(stateDir);
        const globalStatePath = path.join(stateDir, 'opencode.global.dat');
        const workspaceStatePath = path.join(stateDir, 'opencode.workspace.demo.dat');
        await Bun.write(
            globalStatePath,
            `${JSON.stringify(
                {
                    'layout.page': JSON.stringify({
                        lastProjectSession: {
                            '/Users/test/workspace/delete': { id: 'ses_delete' },
                            '/Users/test/workspace/keep': { id: 'ses_keep' },
                        },
                    }),
                    notification: JSON.stringify({
                        list: [
                            { session: 'ses_delete', type: 'turn-complete' },
                            { session: 'ses_keep', type: 'turn-complete' },
                        ],
                    }),
                    permission: JSON.stringify({
                        autoAccept: {
                            'workspace/ses_delete': true,
                            'workspace/ses_keep': true,
                        },
                    }),
                    server: JSON.stringify({
                        lastProject: { local: '/Users/test/workspace/delete' },
                        projects: {
                            local: [
                                { expanded: true, worktree: '/Users/test/workspace/delete' },
                                { expanded: true, worktree: '/Users/test/workspace/keep' },
                            ],
                        },
                    }),
                    tabs: JSON.stringify([
                        { sessionId: 'ses_delete', type: 'session' },
                        {
                            dirBase64: Buffer.from('/Users/test/workspace/delete')
                                .toString('base64')
                                .replace(/=+$/u, ''),
                            sessionId: 'ses_other_deleted_project',
                            type: 'session',
                        },
                        { sessionId: 'ses_keep', type: 'session' },
                    ]),
                },
                null,
                '\t',
            )}\n`,
        );
        await Bun.write(
            workspaceStatePath,
            `${JSON.stringify(
                {
                    'session:ses_delete:comments': JSON.stringify({ comments: {} }),
                    'session:ses_delete:prompt': JSON.stringify({ prompt: [] }),
                    'session:ses_keep:prompt': JSON.stringify({ prompt: [] }),
                    'workspace:followup': JSON.stringify({
                        edit: { ses_delete: true },
                        failed: { ses_delete: true },
                        items: { ses_delete: true },
                        paused: { ses_delete: true, ses_keep: true },
                    }),
                    'workspace:model-selection': JSON.stringify({
                        session: {
                            ses_delete: { agent: 'build' },
                            ses_keep: { agent: 'build' },
                        },
                    }),
                },
                null,
                '\t',
            )}\n`,
        );

        const changedFiles = await deleteOpenCodeDesktopSessionState(['ses_delete'], stateDir, [
            '/Users/test/workspace/delete',
        ]);

        expect(changedFiles.sort()).toEqual([globalStatePath, workspaceStatePath].sort());
        const globalState = JSON.parse(await Bun.file(globalStatePath).text());
        const layoutPage = JSON.parse(globalState['layout.page']);
        const notification = JSON.parse(globalState.notification);
        const permission = JSON.parse(globalState.permission);
        const server = JSON.parse(globalState.server);
        const tabs = JSON.parse(globalState.tabs);
        expect(layoutPage.lastProjectSession).toEqual({
            '/Users/test/workspace/keep': { id: 'ses_keep' },
        });
        expect(notification.list).toEqual([{ session: 'ses_keep', type: 'turn-complete' }]);
        expect(permission.autoAccept).toEqual({ 'workspace/ses_keep': true });
        expect(server).toEqual({
            lastProject: {},
            projects: {
                local: [{ expanded: true, worktree: '/Users/test/workspace/keep' }],
            },
        });
        expect(tabs).toEqual([{ sessionId: 'ses_keep', type: 'session' }]);

        const workspaceState = JSON.parse(await Bun.file(workspaceStatePath).text());
        const followup = JSON.parse(workspaceState['workspace:followup']);
        const modelSelection = JSON.parse(workspaceState['workspace:model-selection']);
        expect(workspaceState['session:ses_delete:prompt']).toBeUndefined();
        expect(workspaceState['session:ses_delete:comments']).toBeUndefined();
        expect(workspaceState['session:ses_keep:prompt']).toBe(JSON.stringify({ prompt: [] }));
        expect(followup).toEqual({
            edit: {},
            failed: {},
            items: {},
            paused: { ses_keep: true },
        });
        expect(modelSelection.session).toEqual({ ses_keep: { agent: 'build' } });
    });

    it('should delete OpenCode Desktop state even when the database session is already gone', async () => {
        const dbPath = await createFixtureDb();
        const stateDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-missing-desktop-state-'));
        tempDirs.push(stateDir);
        const previousStateDir = process.env.SPIRACHA_OPENCODE_DESKTOP_STATE_DIR;
        process.env.SPIRACHA_OPENCODE_DESKTOP_STATE_DIR = stateDir;
        const globalStatePath = path.join(stateDir, 'opencode.global.dat');
        await Bun.write(
            globalStatePath,
            `${JSON.stringify(
                {
                    'layout.page': JSON.stringify({
                        lastProjectSession: {
                            '/Users/test/workspace/delete': { id: 'ses_missing' },
                            '/Users/test/workspace/keep': { id: 'ses_main' },
                        },
                    }),
                },
                null,
                '\t',
            )}\n`,
        );

        try {
            const result = await deleteOpenCodeSession(dbPath, 'ses_missing');

            expect(result.deletedSessionIds).toEqual([]);
            const globalState = JSON.parse(await Bun.file(globalStatePath).text());
            const layoutPage = JSON.parse(globalState['layout.page']);
            expect(layoutPage.lastProjectSession).toEqual({
                '/Users/test/workspace/keep': { id: 'ses_main' },
            });
        } finally {
            if (previousStateDir === undefined) {
                delete process.env.SPIRACHA_OPENCODE_DESKTOP_STATE_DIR;
            } else {
                process.env.SPIRACHA_OPENCODE_DESKTOP_STATE_DIR = previousStateDir;
            }
        }
    });
});
