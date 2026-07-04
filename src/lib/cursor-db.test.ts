import { constants, Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    CURSOR_READONLY_DB_OPEN_FLAGS,
    findCursorWorkspaceGroups,
    getCursorReadonlyDbUri,
    listCursorThreadsForGroup,
    listCursorWorkspaceGroups,
    openCursorReadonlyDb,
    parseCursorBubble,
    readCursorThreadHead,
    readCursorThreadTranscript,
    readCursorThreadTranscriptWithAgentFiles,
} from './cursor-db';
import { getCursorGlobalDbPath } from './cursor-exporter-types';
import { type CursorFixtureSpec, createCursorFixture } from './cursor-test-helpers';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const makeUserDir = async (): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cursor-fixture-'));
    tempDirs.push(dir);
    return dir;
};

const baseSpec = (): CursorFixtureSpec => ({
    buckets: [
        {
            bucketId: 'bucket-new',
            folder: 'file:///Users/test/workspace/demo',
        },
        {
            bucketId: 'bucket-old',
            composerIds: ['thread-1'],
            folder: 'file:///Users/test/workspace/demo',
            threadsInComposerData: true,
        },
    ],
    headerLinks: [{ bucketId: 'bucket-old', composerId: 'thread-1' }],
    threads: [
        {
            bubbles: [
                { bubbleId: 'b1', text: 'First user request', type: 1 },
                { bubbleId: 'b2', text: 'Assistant reply', thinking: 'thinking hard', type: 2 },
                {
                    bubbleId: 'b3',
                    toolCall: { name: 'read_file', rawArgs: '{"path":"x"}', result: 'file contents' },
                    type: 2,
                },
            ],
            composerId: 'thread-1',
            lastUpdatedAt: 1000,
            name: 'Demo thread',
        },
    ],
});

describe('cursor-db workspace discovery', () => {
    it('should group duplicate buckets for the same folder under one workspace', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());

        const groups = await listCursorWorkspaceGroups(userDir);

        expect(groups).toHaveLength(1);
        expect(groups[0]?.label).toBe('demo');
        expect(groups[0]?.buckets).toHaveLength(2);
    });

    it('should count distinct threads once even when they appear in multiple buckets', async () => {
        const userDir = await makeUserDir();
        const spec: CursorFixtureSpec = {
            buckets: [
                {
                    bucketId: 'bucket-a',
                    composerIds: ['thread-1'],
                    folder: 'file:///Users/test/workspace/dup',
                    threadsInComposerData: true,
                },
                {
                    bucketId: 'bucket-b',
                    composerIds: ['thread-1'],
                    folder: 'file:///Users/test/workspace/dup',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [{ bucketId: 'bucket-b', composerId: 'thread-1' }],
            threads: [
                {
                    bubbles: [{ bubbleId: 'b1', text: 'hi', type: 1 }],
                    composerId: 'thread-1',
                    name: 'Shared thread',
                },
            ],
        };
        await createCursorFixture(userDir, spec);

        const [group] = await listCursorWorkspaceGroups(userDir);

        expect(group?.threadCount).toBe(1);
    });

    it('should match a workspace by folder basename query', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());

        const groups = await listCursorWorkspaceGroups(userDir);
        const matched = findCursorWorkspaceGroups(groups, 'demo');

        expect(matched).toHaveLength(1);
        expect(matched[0]?.key).toBe('folder:/Users/test/workspace/demo');
    });

    it('should surface threads whose workspace bucket no longer exists (via header uri)', async () => {
        const userDir = await makeUserDir();
        const spec: CursorFixtureSpec = {
            buckets: [],
            headerLinks: [
                { bucketId: 'deleted-bucket-id', composerId: 'ghost-1', uriPath: '/Users/test/workspace/ghost' },
            ],
            threads: [
                {
                    bubbles: [{ bubbleId: 'b1', text: 'still here', type: 1 }],
                    composerId: 'ghost-1',
                    name: 'Ghost project thread',
                },
            ],
        };
        await createCursorFixture(userDir, spec);

        const groups = await listCursorWorkspaceGroups(userDir);
        const ghost = groups.find((group) => group.label === 'ghost');

        expect(ghost).toBeDefined();
        expect(ghost?.buckets).toHaveLength(0);
        const threads = await listCursorThreadsForGroup(ghost!, userDir, { includeTranscriptDirs: false });
        expect(threads.map((thread) => thread.composerId)).toContain('ghost-1');
    });

    it('should infer the workspace folder from tool-call paths for headerless orphan threads', async () => {
        const userDir = await makeUserDir();
        const spec: CursorFixtureSpec = {
            buckets: [],
            threads: [
                {
                    bubbles: [
                        { bubbleId: 'b1', text: 'build the game', type: 1 },
                        {
                            bubbleId: 'b2',
                            toolCall: {
                                name: 'read_file',
                                rawArgs: '{"path":"/Users/test/workspace/inferme/src/main.ts"}',
                                result: 'ok',
                            },
                            type: 2,
                        },
                    ],
                    composerId: 'orphan-1',
                    name: 'Orphaned racing game',
                },
            ],
        };
        await createCursorFixture(userDir, spec);

        const groups = await listCursorWorkspaceGroups(userDir);
        const inferred = groups.find((group) => group.label === 'inferme');

        expect(inferred).toBeDefined();
        const threads = await listCursorThreadsForGroup(inferred!, userDir, { includeTranscriptDirs: false });
        expect(threads.map((thread) => thread.composerId)).toContain('orphan-1');
    });

    it('should infer the workspace folder from head content for empty headerless threads', async () => {
        const userDir = await makeUserDir();
        const spec: CursorFixtureSpec = {
            buckets: [],
            threads: [
                {
                    bubbles: [],
                    composerId: 'head-only-1',
                    headText: 'Review `/Users/test/workspace/head-inferred/docs/plan.md`.',
                    name: 'Head-only review',
                },
            ],
        };
        await createCursorFixture(userDir, spec);

        const groups = await listCursorWorkspaceGroups(userDir);
        const inferred = groups.find((group) => group.label === 'head-inferred');

        expect(inferred).toBeDefined();
        const threads = await listCursorThreadsForGroup(inferred!, userDir, { includeTranscriptDirs: false });
        expect(threads.map((thread) => thread.composerId)).toContain('head-only-1');
        expect(threads[0]?.bubbleCount).toBe(0);
    });

    it('should surface projects that only exist in Cursor file history', async () => {
        const userDir = await makeUserDir();
        const spec: CursorFixtureSpec = {
            buckets: [],
            historyEntries: [
                {
                    resource: 'file:///Users/test/workspace/history-only/src/main.ts',
                    timestamps: [4000, 5000],
                },
            ],
            threads: [],
        };
        await createCursorFixture(userDir, spec);

        const groups = await listCursorWorkspaceGroups(userDir);
        const historyOnly = groups.find((group) => group.label === 'history-only');

        expect(historyOnly).toBeDefined();
        expect(historyOnly?.buckets).toHaveLength(0);
        expect(historyOnly?.threadCount).toBe(0);
        expect(historyOnly?.lastActiveMs).toBe(5000);
        expect(await listCursorThreadsForGroup(historyOnly!, userDir, { includeTranscriptDirs: false })).toEqual([]);
    });

    it('should ignore null global composer heads during workspace discovery', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, {
            buckets: [],
            threads: [],
        });
        const db = new Database(getCursorGlobalDbPath(userDir));
        try {
            db.run('INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)', [
                'composerData:null-head',
                'null',
            ]);
        } finally {
            db.close();
        }

        const groups = await listCursorWorkspaceGroups(userDir);

        expect(groups).toEqual([]);
    });

    it('should ignore SQL null global composer head values during workspace discovery', async () => {
        const userDir = await makeUserDir();
        const globalDir = path.join(userDir, 'globalStorage');
        await mkdir(globalDir, { recursive: true });
        const db = new Database(getCursorGlobalDbPath(userDir));
        try {
            db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
            db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)');
            db.run('INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)', [
                'composerData:sql-null-head',
                null,
            ]);
        } finally {
            db.close();
        }

        const groups = await listCursorWorkspaceGroups(userDir);

        expect(groups).toEqual([]);
    });

    it('should list threads for a workspace with bubble counts', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());

        const [group] = await listCursorWorkspaceGroups(userDir);
        const threads = await listCursorThreadsForGroup(group!, userDir);

        expect(threads).toHaveLength(1);
        expect(threads[0]?.composerId).toBe('thread-1');
        expect(threads[0]?.bubbleCount).toBe(3);
        expect(threads[0]?.name).toBe('Demo thread');
    });

    it('should resolve transcript directories from the explicit Cursor user dir', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });

        const [group] = await listCursorWorkspaceGroups(userDir);
        const threads = await listCursorThreadsForGroup(group!, userDir);

        expect(threads[0]?.transcriptDirs).toEqual([transcriptDir]);
    });

    it('should parse JSONC code-workspace files when resolving workspace folders', async () => {
        const userDir = await makeUserDir();
        const workspaceFilePath = path.join(userDir, 'demo.code-workspace');
        await Bun.write(
            workspaceFilePath,
            [
                '{',
                '  // Cursor and VS Code commonly preserve comments here.',
                '  "folders": [',
                '    { "path": "packages/app" }',
                '  ]',
                '}',
            ].join('\n'),
        );
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'workspace-bucket',
                    workspace: `file://${workspaceFilePath}`,
                },
            ],
            threads: [],
        });

        const [group] = await listCursorWorkspaceGroups(userDir);

        expect(group?.folders).toEqual([path.join(userDir, 'packages/app')]);
    });

    it('should ignore stale code-workspace references without warning', async () => {
        const userDir = await makeUserDir();
        const workspaceFilePath = path.join(userDir, 'missing.code-workspace');
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'stale-workspace-bucket',
                    workspace: `file://${workspaceFilePath}`,
                },
            ],
            threads: [],
        });
        const warn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => warnings.push(args);

        try {
            const [group] = await listCursorWorkspaceGroups(userDir);

            expect(group?.folders).toEqual([]);
            expect(warnings).toEqual([]);
        } finally {
            console.warn = warn;
        }
    });
});

describe('cursor-db transcript reads', () => {
    it('should read an ordered thread head from the global store', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());

        const head = readCursorThreadHead(getCursorGlobalDbPath(userDir), 'thread-1');

        expect(head?.orderedBubbleIds).toEqual(['b1', 'b2', 'b3']);
        expect(head?.name).toBe('Demo thread');
    });

    it('should resolve renderable bubbles in order', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());

        const transcript = readCursorThreadTranscript(getCursorGlobalDbPath(userDir), 'thread-1');

        expect(transcript?.renderableBubbleCount).toBe(3);
        expect(transcript?.bubbles[0]?.kind).toBe('user');
        expect(transcript?.bubbles[2]?.toolCall?.name).toBe('read_file');
    });

    it('should report omitted bubbles when Cursor truncated the header index', async () => {
        const userDir = await makeUserDir();
        const spec = baseSpec();
        spec.threads[0]!.omittedBubbleHeaders = 50;
        await createCursorFixture(userDir, spec);

        const transcript = readCursorThreadTranscript(getCursorGlobalDbPath(userDir), 'thread-1');

        expect(transcript?.omittedBubbleCount).toBe(50);
    });

    it('should append tail messages from Cursor agent transcript files', async () => {
        const userDir = await makeUserDir();
        const spec = baseSpec();
        spec.threads[0]!.bubbles = [
            { bubbleId: 'b1', text: 'Original request', type: 1 },
            { bubbleId: 'b2', text: 'Known assistant update', type: 2 },
        ];
        await createCursorFixture(userDir, spec);
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(transcriptDir, 'thread-1.jsonl'),
            [
                JSON.stringify({
                    message: { content: [{ text: 'Known assistant update', type: 'text' }] },
                    role: 'assistant',
                }),
                JSON.stringify({
                    message: { content: [{ text: 'Did I read the transcript? Yes, now.', type: 'text' }] },
                    role: 'assistant',
                }),
                JSON.stringify({ status: 'success', type: 'result' }),
            ].join('\n'),
        );

        const transcript = await readCursorThreadTranscriptWithAgentFiles(
            getCursorGlobalDbPath(userDir),
            'thread-1',
            userDir,
        );

        expect(transcript?.bubbles.map((bubble) => bubble.text)).toEqual([
            'Original request',
            'Known assistant update',
            'Did I read the transcript? Yes, now.',
        ]);
        expect(transcript?.renderableBubbleCount).toBe(3);
    });

    it('should append all agent transcript messages when no overlap exists', async () => {
        const userDir = await makeUserDir();
        const spec = baseSpec();
        spec.threads[0]!.bubbles = [{ bubbleId: 'b1', text: 'Original request', type: 1 }];
        await createCursorFixture(userDir, spec);
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(transcriptDir, 'thread-1.jsonl'),
            [
                JSON.stringify({
                    message: { content: [{ text: 'New agent message one', type: 'text' }] },
                    role: 'assistant',
                }),
                JSON.stringify({
                    message: { content: [{ text: 'New agent message two', type: 'text' }] },
                    role: 'assistant',
                }),
            ].join('\n'),
        );

        const transcript = await readCursorThreadTranscriptWithAgentFiles(
            getCursorGlobalDbPath(userDir),
            'thread-1',
            userDir,
        );

        expect(transcript?.bubbles.map((bubble) => bubble.text)).toEqual([
            'Original request',
            'New agent message one',
            'New agent message two',
        ]);
    });

    it('should not append duplicate bubbles when agent transcript is already covered by SQLite bubbles', async () => {
        const userDir = await makeUserDir();
        const spec = baseSpec();
        spec.threads[0]!.bubbles = [
            { bubbleId: 'b1', text: 'Original request', type: 1 },
            { bubbleId: 'b2', text: 'Known assistant update', type: 2 },
        ];
        await createCursorFixture(userDir, spec);
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(transcriptDir, 'thread-1.jsonl'),
            [
                JSON.stringify({
                    message: { content: [{ text: 'Original request', type: 'text' }] },
                    role: 'user',
                }),
                JSON.stringify({
                    message: { content: [{ text: 'Known assistant update', type: 'text' }] },
                    role: 'assistant',
                }),
            ].join('\n'),
        );

        const transcript = await readCursorThreadTranscriptWithAgentFiles(
            getCursorGlobalDbPath(userDir),
            'thread-1',
            userDir,
        );

        expect(transcript?.bubbles.map((bubble) => bubble.text)).toEqual([
            'Original request',
            'Known assistant update',
        ]);
        expect(transcript?.renderableBubbleCount).toBe(2);
    });

    it('should preserve ordered tail messages from multiple agent transcript files', async () => {
        const userDir = await makeUserDir();
        const spec = baseSpec();
        spec.threads[0]!.bubbles = [{ bubbleId: 'b1', text: 'Original request', type: 1 }];
        await createCursorFixture(userDir, spec);
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(transcriptDir, 'thread-1-part1.jsonl'),
            JSON.stringify({ message: { content: [{ text: 'Part one', type: 'text' }] }, role: 'assistant' }),
        );
        await Bun.write(
            path.join(transcriptDir, 'thread-1-part2.jsonl'),
            JSON.stringify({ message: { content: [{ text: 'Part two', type: 'text' }] }, role: 'assistant' }),
        );

        const transcript = await readCursorThreadTranscriptWithAgentFiles(
            getCursorGlobalDbPath(userDir),
            'thread-1',
            userDir,
        );

        expect(transcript?.bubbles.map((bubble) => bubble.text)).toEqual(['Original request', 'Part one', 'Part two']);
    });

    it('should treat superset agent messages as overlap when merging tail bubbles', async () => {
        const userDir = await makeUserDir();
        const spec = baseSpec();
        spec.threads[0]!.bubbles = [
            { bubbleId: 'b1', text: 'Original request', type: 1 },
            { bubbleId: 'b2', text: 'Known assistant update', type: 2 },
        ];
        await createCursorFixture(userDir, spec);
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(transcriptDir, 'thread-1.jsonl'),
            [
                JSON.stringify({
                    message: { content: [{ text: 'Known assistant update with extra streamed text', type: 'text' }] },
                    role: 'assistant',
                }),
                JSON.stringify({
                    message: { content: [{ text: 'Final tail message', type: 'text' }] },
                    role: 'assistant',
                }),
            ].join('\n'),
        );

        const transcript = await readCursorThreadTranscriptWithAgentFiles(
            getCursorGlobalDbPath(userDir),
            'thread-1',
            userDir,
        );

        expect(transcript?.bubbles.map((bubble) => bubble.text)).toEqual([
            'Original request',
            'Known assistant update',
            'Final tail message',
        ]);
    });

    it('should merge agent transcript tails without duplicating overlapping tool calls with output', async () => {
        const userDir = await makeUserDir();
        const spec = baseSpec();
        spec.threads[0]!.bubbles = [
            { bubbleId: 'b1', text: 'Original request', type: 1 },
            {
                bubbleId: 'b2',
                toolCall: {
                    name: 'read_file',
                    rawArgs: '{\n  "path": "README.md"\n}',
                    result: 'file contents',
                    toolCallId: 'tool-1',
                },
                type: 2,
            },
        ];
        await createCursorFixture(userDir, spec);
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(transcriptDir, 'thread-1.jsonl'),
            [
                JSON.stringify({
                    message: {
                        content: [{ id: 'tool-1', input: { path: 'README.md' }, name: 'read_file', type: 'tool_use' }],
                    },
                    role: 'assistant',
                }),
                JSON.stringify({
                    message: { content: [{ text: 'Final answer after reading README.', type: 'text' }] },
                    role: 'assistant',
                }),
            ].join('\n'),
        );

        const transcript = await readCursorThreadTranscriptWithAgentFiles(
            getCursorGlobalDbPath(userDir),
            'thread-1',
            userDir,
        );

        expect(transcript?.bubbles.map((bubble) => bubble.toolCall?.name).filter(Boolean)).toEqual(['read_file']);
        expect(transcript?.bubbles.map((bubble) => bubble.text).filter(Boolean)).toEqual([
            'Original request',
            'Final answer after reading README.',
        ]);
    });

    it('should warn and continue when agent transcript JSONL lines are malformed', async () => {
        const userDir = await makeUserDir();
        const spec = baseSpec();
        spec.threads[0]!.bubbles = [{ bubbleId: 'b1', text: 'Original request', type: 1 }];
        await createCursorFixture(userDir, spec);
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(transcriptDir, 'thread-1.jsonl'),
            [
                '{not-json',
                JSON.stringify({
                    message: { content: [{ text: 'Recovered tail.', type: 'text' }] },
                    role: 'assistant',
                }),
            ].join('\n'),
        );
        const warn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => warnings.push(args);

        try {
            const transcript = await readCursorThreadTranscriptWithAgentFiles(
                getCursorGlobalDbPath(userDir),
                'thread-1',
                userDir,
            );

            expect(transcript?.bubbles.map((bubble) => bubble.text)).toEqual(['Original request', 'Recovered tail.']);
            expect(warnings.some((args) => String(args[0]).includes('invalid_agent_transcript_jsonl'))).toBe(true);
        } finally {
            console.warn = warn;
        }
    });
});

describe('openCursorReadonlyDb', () => {
    it('should enable sqlite uri parsing for immutable readonly opens', () => {
        expect(CURSOR_READONLY_DB_OPEN_FLAGS & constants.SQLITE_OPEN_READONLY).toBe(constants.SQLITE_OPEN_READONLY);
        expect(CURSOR_READONLY_DB_OPEN_FLAGS & constants.SQLITE_OPEN_URI).toBe(constants.SQLITE_OPEN_URI);
    });

    it('should build a portable immutable file uri for absolute database paths', () => {
        const uri = getCursorReadonlyDbUri('/home/runner/work/spiracha/with space/state.vscdb');

        expect(uri).toBe('file:///home/runner/work/spiracha/with%20space/state.vscdb?immutable=1');
    });

    it('should read a WAL database after a clean shutdown removed the -wal/-shm sidecars', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'cursor-wal-'));
        tempDirs.push(dir);
        const dbPath = path.join(dir, 'state.vscdb');

        const writable = new Database(dbPath);
        writable.exec('PRAGMA journal_mode=WAL');
        writable.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
        writable.run('INSERT INTO ItemTable VALUES (?, ?)', ['a', 'b']);
        writable.close();
        await rm(`${dbPath}-wal`, { force: true });
        await rm(`${dbPath}-shm`, { force: true });

        const db = openCursorReadonlyDb(dbPath);
        try {
            const row = db.query('SELECT COUNT(*) AS count FROM ItemTable').get() as { count: number };
            expect(row.count).toBe(1);
        } finally {
            db.close();
        }
    });
});

describe('parseCursorBubble', () => {
    it('should classify user and assistant bubble kinds', () => {
        expect(parseCursorBubble('a', { text: 'hi', type: 1 }).kind).toBe('user');
        expect(parseCursorBubble('b', { text: 'yo', type: 2 }).kind).toBe('assistant');
    });

    it('should extract thinking text and tool call data', () => {
        const bubble = parseCursorBubble('c', {
            text: '',
            thinking: { signature: '', text: 'reasoning' },
            toolFormerData: { name: 'run', rawArgs: '{}', result: 'ok', status: 'completed' },
            type: 2,
        });

        expect(bubble.thinking).toBe('reasoning');
        expect(bubble.toolCall?.name).toBe('run');
        expect(bubble.toolCall?.resultText).toBe('ok');
    });
});
