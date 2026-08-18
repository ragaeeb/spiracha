import { constants, Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    CURSOR_MAX_HISTORY_ENTRIES_BYTES,
    CURSOR_READONLY_DB_OPEN_FLAGS,
    CURSOR_SQLITE_RETRY_DELAYS_MS,
    decodeCursorUri,
    findCursorTranscriptDirs,
    findCursorTranscriptDirsForComposerIds,
    findCursorWorkspaceGroups,
    getCursorReadonlyDbUri,
    listCursorThreadsForGroup,
    listCursorWorkspaceGroups,
    openCursorReadonlyDb,
    parseCursorBubble,
    readCursorThreadHead,
    readCursorThreadTranscript,
    readCursorThreadTranscriptWithAgentFiles,
    withCursorReadonlyDb,
} from './cursor-db';
import { getCursorGlobalDbPath } from './cursor-exporter-types';
import { type CursorFixtureSpec, createCursorFixture, holdCursorWriteLock } from './cursor-test-helpers';

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
    it('should preserve malformed percent escapes in workspace URIs', () => {
        expect(decodeCursorUri('file:///Users/test/workspace/100%done')).toBe('/Users/test/workspace/100%done');
    });

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

    it('should defer bubble payload scans until exact thread stats are requested', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());

        const originalQuery = Database.prototype.query;
        let bubblePayloadQueryCount = 0;
        Database.prototype.query = function (this: Database, sql: string) {
            if (sql.includes('SELECT ? AS composerId, key, value FROM cursorDiskKV')) {
                bubblePayloadQueryCount += 1;
            }

            return originalQuery.call(this, sql);
        } as typeof originalQuery;

        try {
            const [group] = await listCursorWorkspaceGroups(userDir);
            expect(bubblePayloadQueryCount).toBe(0);

            const threadsWithoutStats = await listCursorThreadsForGroup(group!, userDir, {
                includeBubbleStats: false,
                includeTranscriptDirs: false,
            });
            expect(threadsWithoutStats).toEqual([expect.objectContaining({ bubbleBytes: 0, bubbleCount: 0 })]);
            expect(bubblePayloadQueryCount).toBe(0);

            const threads = await listCursorThreadsForGroup(group!, userDir, {
                includeBubbleStats: true,
                includeTranscriptDirs: false,
            });

            expect(bubblePayloadQueryCount).toBe(1);
            expect(threads).toEqual([expect.objectContaining({ bubbleBytes: expect.any(Number), bubbleCount: 3 })]);
        } finally {
            Database.prototype.query = originalQuery;
        }
    });

    it('should count bubbles for composer ids containing colons', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'colon-bucket',
                    composerIds: ['thread:colon'],
                    folder: 'file:///Users/test/workspace/colon',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [{ bucketId: 'colon-bucket', composerId: 'thread:colon' }],
            threads: [{ bubbles: [{ bubbleId: 'b1', text: 'colon-safe', type: 1 }], composerId: 'thread:colon' }],
        });

        const [group] = await listCursorWorkspaceGroups(userDir);
        const threads = await listCursorThreadsForGroup(group!, userDir, { includeTranscriptDirs: false });

        expect(threads).toEqual([expect.objectContaining({ bubbleCount: 1, composerId: 'thread:colon' })]);
    });

    it('should keep a short composer id separate from a colon-bearing child id', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'prefix-bucket',
                    composerIds: ['thread', 'thread:child'],
                    folder: 'file:///Users/test/workspace/prefix',
                    threadsInComposerData: true,
                },
            ],
            headerLinks: [
                { bucketId: 'prefix-bucket', composerId: 'thread' },
                { bucketId: 'prefix-bucket', composerId: 'thread:child' },
            ],
            threads: [
                { bubbles: [{ bubbleId: 'parent-bubble', text: 'parent', type: 1 }], composerId: 'thread' },
                {
                    bubbles: [{ bubbleId: 'child-bubble', text: 'child', type: 1 }],
                    composerId: 'thread:child',
                },
            ],
        });

        const [group] = await listCursorWorkspaceGroups(userDir);
        const threads = await listCursorThreadsForGroup(group!, userDir, { includeTranscriptDirs: false });

        expect(new Map(threads.map((thread) => [thread.composerId, thread.bubbleCount]))).toEqual(
            new Map([
                ['thread', 1],
                ['thread:child', 1],
            ]),
        );
    });

    it('should diagnose oversized history entries before parsing them', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, {
            buckets: [],
            historyEntries: [{ resource: 'file:///Users/test/workspace/oversized/src/index.ts' }],
            threads: [],
        });
        const entriesPath = path.join(userDir, 'History', 'history-0', 'entries.json');
        await Bun.write(
            entriesPath,
            JSON.stringify({
                padding: 'x'.repeat(CURSOR_MAX_HISTORY_ENTRIES_BYTES),
                resource: 'file:///Users/test/workspace/oversized/src/index.ts',
            }),
        );

        const warnings: unknown[][] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args);
        try {
            await listCursorWorkspaceGroups(userDir);
        } finally {
            console.warn = originalWarn;
        }

        expect(warnings.some((args) => String(args[0]).includes('history_entries_oversized'))).toBe(true);
    });

    it('should tolerate a valid but malformed history entries shape', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, {
            buckets: [],
            historyEntries: [{ resource: 'file:///Users/test/workspace/malformed-shape/src/index.ts' }],
            threads: [],
        });
        await Bun.write(
            path.join(userDir, 'History', 'history-0', 'entries.json'),
            JSON.stringify({
                entries: { timestamp: 'not-a-number' },
                resource: 'file:///Users/test/workspace/malformed-shape',
            }),
        );

        await expect(listCursorWorkspaceGroups(userDir)).resolves.toEqual([
            expect.objectContaining({ key: 'folder:/Users/test/workspace/malformed-shape' }),
        ]);
    });

    it('should group modern Cursor orchestrators and subagents under their multi-root workspace', async () => {
        const userDir = await makeUserDir();
        const workspaceFilePath = path.join(userDir, 'multi-root.code-workspace');
        await Bun.write(
            workspaceFilePath,
            JSON.stringify({ folders: [{ path: '/Users/test/workspace/app' }, { path: '/Users/test/workspace/e2e' }] }),
        );
        await createCursorFixture(userDir, {
            buckets: [
                {
                    bucketId: 'multi-root-bucket',
                    workspace: `file://${workspaceFilePath}`,
                },
            ],
            composerTableHeaders: [
                { bucketId: 'multi-root-bucket', composerId: 'orchestrator' },
                {
                    bucketId: 'multi-root-bucket',
                    composerId: 'subagent',
                    isSubagent: true,
                    parentComposerId: 'orchestrator',
                },
                {
                    bucketId: 'multi-root-bucket',
                    composerId: 'aborted-draft',
                    isArchived: true,
                },
            ],
            threads: [
                {
                    bubbles: [{ bubbleId: 'root-user', text: 'You are the orchestrator and lead...', type: 1 }],
                    composerId: 'orchestrator',
                    model: 'claude-fable-5',
                    name: 'Vendor externalization gap',
                    reasoningEffort: 'low',
                },
                {
                    bubbles: [
                        {
                            bubbleId: 'child-user',
                            text: 'You are investigating a parked...',
                            toolCall: {
                                name: 'read_file',
                                rawArgs: '{"path":"/Users/test/workspace/e2e/src/test.ts"}',
                            },
                            type: 1,
                        },
                    ],
                    composerId: 'subagent',
                    model: 'cursor-grok-4.5-medium',
                    name: 'Investigate parked test',
                },
                {
                    bubbles: [],
                    composerId: 'aborted-draft',
                    model: 'claude-fable-5',
                    name: 'Vendor externalization gap',
                    status: 'aborted',
                },
            ],
        });

        const groups = await listCursorWorkspaceGroups(userDir);
        const workspace = groups.find((group) => group.key === `workspace:${workspaceFilePath}`);
        const threads = await listCursorThreadsForGroup(workspace!, userDir, { includeTranscriptDirs: false });

        expect(workspace?.threadCount).toBe(2);
        expect(threads.every((thread) => thread.workspaceLabel === 'multi-root.code-workspace')).toBe(true);
        expect(threads).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    composerId: 'orchestrator',
                    model: 'claude-fable-5',
                    parentComposerId: null,
                    reasoningEffort: 'low',
                }),
                expect.objectContaining({
                    composerId: 'subagent',
                    model: 'grok-4.5',
                    parentComposerId: 'orchestrator',
                    reasoningEffort: 'medium',
                }),
            ]),
        );
        expect(groups.find((group) => group.key === 'folder:/Users/test/workspace/e2e')?.threadCount ?? 0).toBe(0);
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

    it('should resolve transcript directories for a deletion batch in one result map', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());
        const firstDir = path.join(userDir, 'projects', 'first', 'agent-transcripts', 'thread-1');
        const secondDir = path.join(userDir, 'projects', 'second', 'agent-transcripts', 'thread-2');
        await Promise.all([mkdir(firstDir, { recursive: true }), mkdir(secondDir, { recursive: true })]);

        const matches = await findCursorTranscriptDirsForComposerIds(['thread-1', 'thread-2', '../../unsafe'], userDir);

        expect(matches.get('thread-1')).toEqual([firstDir]);
        expect(matches.get('thread-2')).toEqual([secondDir]);
        expect(matches.has('../../unsafe')).toBe(false);
    });

    it('should discover a Cursor CLI transcript without a SQLite composer record', async () => {
        const userDir = await makeUserDir();
        const composerId = '73d679d2-5311-4e00-8be3-af67fbf0fa87';
        const projectDir = path.join(userDir, 'projects', 'Users-test-workspace-kalu');
        const transcriptDir = path.join(projectDir, 'agent-transcripts', composerId);
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(projectDir, '.workspace-trusted'),
            JSON.stringify({ workspacePath: '/Users/test/workspace/kalu' }),
        );
        await Bun.write(
            path.join(transcriptDir, `${composerId}.jsonl`),
            [
                JSON.stringify({
                    message: {
                        content: [
                            {
                                text: 'READ-ONLY review triage. Read root and nearest AGENTS.',
                                type: 'text',
                            },
                        ],
                    },
                    role: 'user',
                }),
                JSON.stringify({
                    message: { content: [{ text: 'Review complete.', type: 'text' }] },
                    role: 'assistant',
                }),
            ].join('\n'),
        );

        const groups = await listCursorWorkspaceGroups(userDir);
        const group = groups.find((candidate) => candidate.key === 'folder:/Users/test/workspace/kalu');
        const threads = group ? await listCursorThreadsForGroup(group, userDir) : [];
        const transcript = await readCursorThreadTranscriptWithAgentFiles(
            getCursorGlobalDbPath(userDir),
            composerId,
            userDir,
        );

        expect(group?.folders).toEqual(['/Users/test/workspace/kalu']);
        expect(threads).toHaveLength(1);
        expect(threads[0]).toMatchObject({
            bubbleCount: 2,
            composerId,
            name: 'READ-ONLY review triage. Read root and nearest AGENTS.',
            transcriptDirs: [transcriptDir],
        });
        expect(transcript?.bubbles.map((bubble) => bubble.text)).toEqual([
            'READ-ONLY review triage. Read root and nearest AGENTS.',
            'Review complete.',
        ]);
    });

    it('should hydrate a CLI-only thread model from its modern Cursor chat store', async () => {
        const userDir = await makeUserDir();
        const composerId = '73d679d2-5311-4e00-8be3-af67fbf0fa87';
        const projectDir = path.join(userDir, 'projects', 'Users-test-workspace-kalu');
        const transcriptDir = path.join(projectDir, 'agent-transcripts', composerId);
        const storePath = path.join(userDir, 'chats', '3e5df7fc57ed37c7864c9a0f7ec0d12d', composerId, 'store.db');
        await mkdir(transcriptDir, { recursive: true });
        await mkdir(path.dirname(storePath), { recursive: true });
        await Bun.write(
            path.join(projectDir, '.workspace-trusted'),
            JSON.stringify({ workspacePath: '/Users/test/workspace/kalu' }),
        );
        await Bun.write(
            path.join(transcriptDir, `${composerId}.jsonl`),
            JSON.stringify({ message: { content: [{ text: 'Review this.', type: 'text' }] }, role: 'user' }),
        );
        const store = new Database(storePath);
        store.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB NOT NULL)');
        store
            .query('INSERT INTO blobs (id, data) VALUES (?, ?)')
            .run('chat', new TextEncoder().encode('\u0000metadata\u0000cursor-grok-4.6-low\u0000'));
        store.close();

        const group = (await listCursorWorkspaceGroups(userDir)).find(
            (candidate) => candidate.key === 'folder:/Users/test/workspace/kalu',
        );
        const threads = group ? await listCursorThreadsForGroup(group, userDir, { includeTranscriptDirs: false }) : [];

        expect(threads[0]).toMatchObject({
            composerId,
            model: 'grok-4.6',
            reasoningEffort: 'low',
        });
    });

    it('should reject composer ids that escape the agent transcript directory', async () => {
        const userDir = await makeUserDir();
        await mkdir(path.join(userDir, 'projects', 'demo-project', 'agent-transcripts'), { recursive: true });

        expect(await findCursorTranscriptDirs('..', userDir)).toEqual([]);
        expect(await findCursorTranscriptDirs('../../..', userDir)).toEqual([]);
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

    it('should use pre-resolved transcript directories without rediscovering them', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());
        const transcriptDir = path.join(userDir, 'projects', 'demo-project', 'agent-transcripts', 'thread-1');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(
            path.join(transcriptDir, 'thread-1.jsonl'),
            JSON.stringify({ message: { content: [{ text: 'Agent-only tail', type: 'text' }] }, role: 'assistant' }),
        );

        const transcript = await readCursorThreadTranscriptWithAgentFiles(
            getCursorGlobalDbPath(userDir),
            'thread-1',
            userDir,
            [],
        );

        expect(transcript?.bubbles.map((bubble) => bubble.text)).toEqual(['First user request', 'Assistant reply', '']);
        expect(transcript?.bubbles.some((bubble) => bubble.text === 'Agent-only tail')).toBe(false);
    });

    it('should skip stale CLI transcript parsing before reading its contents', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());
        const projectDir = path.join(userDir, 'projects', 'stale-project');
        const transcriptDir = path.join(projectDir, 'agent-transcripts', 'stale-thread');
        const transcriptPath = path.join(transcriptDir, 'stale-thread.jsonl');
        await mkdir(transcriptDir, { recursive: true });
        await Bun.write(path.join(projectDir, '.workspace-trusted'), JSON.stringify({ workspacePath: '/tmp/stale' }));
        await Bun.write(transcriptPath, '{not-json');
        await utimes(transcriptPath, new Date(1_000), new Date(1_000));

        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => warnings.push(args);
        try {
            await listCursorWorkspaceGroups(userDir, { updatedAfterMs: Date.now() });
        } finally {
            console.warn = originalWarn;
        }

        expect(warnings.some((args) => String(args[0]).includes('invalid_agent_transcript_jsonl'))).toBe(false);
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

    it('should include committed WAL rows while Cursor still has the database open', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'cursor-live-wal-'));
        tempDirs.push(dir);
        const dbPath = path.join(dir, 'state.vscdb');
        const writable = new Database(dbPath);
        writable.exec('PRAGMA journal_mode=WAL');
        writable.exec('PRAGMA wal_autocheckpoint=0');
        writable.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
        writable.run('INSERT INTO ItemTable VALUES (?, ?)', ['live', 'visible']);

        const db = openCursorReadonlyDb(dbPath);
        try {
            const row = db.query('SELECT value FROM ItemTable WHERE key = ?').get('live') as { value: string } | null;
            expect(row?.value).toBe('visible');
        } finally {
            db.close();
            writable.close();
        }
    });

    it('should retry a blocked readonly query while an exclusive writer holds the database', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());
        const globalDbPath = getCursorGlobalDbPath(userDir);
        const retryBudgetMs = CURSOR_SQLITE_RETRY_DELAYS_MS.reduce((total, delayMs) => total + delayMs, 0);
        const lockProcess = await holdCursorWriteLock(globalDbPath, {
            durationMs: Math.floor(retryBudgetMs / 2),
            lockingMode: 'exclusive',
        });

        try {
            const count = withCursorReadonlyDb(globalDbPath, (db) => {
                return (db.query('SELECT COUNT(*) AS count FROM cursorDiskKV').get() as { count: number }).count;
            });

            expect(count).toBeGreaterThan(0);
        } finally {
            lockProcess.kill();
            await lockProcess.exited;
        }
    });

    it('should reject an asynchronous callback instead of closing its handle early', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, baseSpec());

        expect(() =>
            withCursorReadonlyDb(getCursorGlobalDbPath(userDir), async () => {
                await Promise.resolve();
                return null;
            }),
        ).toThrow('Cursor SQLite callbacks must be synchronous');
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
