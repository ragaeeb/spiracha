import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { chmod, mkdir, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteAntigravityConversation,
    getAntigravityConversationById,
    groupAntigravityConversations,
    listAntigravityConversations,
    readAntigravityConversationMessages,
    renderAntigravityArtifactsMarkdown,
    renderAntigravityConversationMarkdown,
} from './antigravity-db';
import { ANTIGRAVITY_TRANSCRIPT_MARKDOWN_VERSION } from './antigravity-transcript-contract';
import { antigravityMarkdownToThreadEvents } from './antigravity-transcript-events';

type SummaryFixture = {
    id: string;
    title: string;
    indexedItemCount?: number;
    createdAtSeconds?: number;
    projectId?: string;
    updatedAtSeconds?: number;
    workspaceUri?: string;
};

const encodeVarint = (value: number): number[] => {
    const bytes: number[] = [];
    let remaining = value;
    while (remaining >= 0x80) {
        bytes.push((remaining & 0x7f) | 0x80);
        remaining = Math.floor(remaining / 0x80);
    }
    bytes.push(remaining);
    return bytes;
};

const encodeString = (fieldNumber: number, value: string): number[] => {
    const bytes = [...Buffer.from(value, 'utf8')];
    return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(bytes.length), ...bytes];
};

const encodeMessage = (fieldNumber: number, value: number[]): number[] => {
    return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(value.length), ...value];
};

const encodeNumber = (fieldNumber: number, value: number): number[] => {
    return [...encodeVarint(fieldNumber << 3), ...encodeVarint(value)];
};

const encodeTimestamp = (fieldNumber: number, seconds: number): number[] => {
    return encodeMessage(fieldNumber, [...encodeNumber(1, seconds), ...encodeNumber(2, 123_000_000)]);
};

type TrajectoryToolCallFixture = {
    args: Record<string, unknown>;
    id: string;
    name: string;
};

const encodeTrajectoryToolCall = (toolCall: TrajectoryToolCallFixture): number[] =>
    encodeMessage(7, [
        ...encodeString(1, toolCall.id),
        ...encodeString(2, toolCall.name),
        ...encodeString(3, JSON.stringify(toolCall.args)),
        ...encodeString(9, toolCall.name),
    ]);

const encodeTrajectoryMetadata = (toolCall?: TrajectoryToolCallFixture): Uint8Array =>
    new Uint8Array([
        ...encodeTimestamp(1, 1_784_696_184),
        ...(toolCall
            ? encodeMessage(4, [
                  ...encodeString(1, toolCall.id),
                  ...encodeString(2, toolCall.name),
                  ...encodeString(3, JSON.stringify(toolCall.args)),
                  ...encodeString(9, toolCall.name),
              ])
            : []),
    ]);

const encodeTrajectoryStepPayload = (stepType: number, body: number[]): Uint8Array =>
    new Uint8Array([...encodeNumber(1, stepType), ...encodeNumber(4, 3), ...body]);

const writeTrajectoryDatabase = async (root: string, conversationId: string) => {
    const databasePath = path.join(root, 'conversations', `${conversationId}.db`);
    const db = new Database(databasePath, { create: true });
    db.exec(`
        CREATE TABLE steps (
            idx INTEGER PRIMARY KEY,
            step_type INTEGER NOT NULL,
            status INTEGER NOT NULL,
            metadata BLOB,
            step_payload BLOB
        )
    `);
    const insert = db.prepare(
        'INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)',
    );
    const capabilitiesCall: TrajectoryToolCallFixture = {
        args: {
            CommandLine: 'command -v kodeguard && kodeguard capabilities --json',
            Cwd: '/Users/example/workspace/ushman',
        },
        id: 'call-capabilities',
        name: 'run_command',
    };
    const probeCall: TrajectoryToolCallFixture = {
        args: {
            CommandLine: 'kodeguard drive probe src/cleanup-briefs/apply-decompose.ts --profile decomposition --json',
            Cwd: '/Users/example/workspace/ushman',
        },
        id: 'call-probe',
        name: 'run_command',
    };
    insert.run(
        0,
        14,
        3,
        encodeTrajectoryMetadata(),
        encodeTrajectoryStepPayload(14, encodeMessage(19, encodeString(2, 'Test the Kodeguard workflow.'))),
    );
    insert.run(
        7,
        15,
        3,
        encodeTrajectoryMetadata(),
        encodeTrajectoryStepPayload(15, encodeMessage(20, encodeTrajectoryToolCall(capabilitiesCall))),
    );
    insert.run(
        8,
        21,
        3,
        encodeTrajectoryMetadata(capabilitiesCall),
        encodeTrajectoryStepPayload(
            21,
            encodeMessage(28, [
                ...encodeString(2, '/Users/example/workspace/ushman'),
                ...encodeNumber(6, 0),
                ...encodeMessage(
                    21,
                    encodeString(
                        1,
                        '/Users/example/.bun/bin/kodeguard\n{"schemaVersion":"kodeguard/capabilities/v13"}\n',
                    ),
                ),
                ...encodeString(23, 'command -v kodeguard && kodeguard capabilities --json'),
            ]),
        ),
    );
    insert.run(
        9,
        15,
        3,
        encodeTrajectoryMetadata(),
        encodeTrajectoryStepPayload(15, encodeMessage(20, encodeTrajectoryToolCall(probeCall))),
    );
    insert.run(
        10,
        21,
        3,
        encodeTrajectoryMetadata(probeCall),
        encodeTrajectoryStepPayload(
            21,
            encodeMessage(28, [
                ...encodeString(2, '/Users/example/workspace/ushman'),
                ...encodeNumber(6, 0),
                ...encodeMessage(21, encodeString(1, '{"schemaVersion":"kodeproof/drive-probe/v1"}\n')),
                ...encodeString(
                    23,
                    'kodeguard drive probe src/cleanup-briefs/apply-decompose.ts --profile decomposition --json',
                ),
            ]),
        ),
    );
    insert.run(
        11,
        15,
        3,
        encodeTrajectoryMetadata(),
        encodeTrajectoryStepPayload(
            15,
            encodeMessage(
                20,
                encodeString(
                    3,
                    '**Confirming Test Drive Success**\n\nThe test drive was successful!\n\n**Clarifying Workflow Steps**\n\nI am clarifying the workflow.',
                ),
            ),
        ),
    );
    insert.run(
        12,
        15,
        3,
        encodeTrajectoryMetadata(),
        encodeTrajectoryStepPayload(15, encodeMessage(20, encodeString(1, 'The test drive completed cleanly.'))),
    );
    db.exec('PRAGMA journal_mode = WAL');
    db.close();
    await Promise.all([rm(`${databasePath}-shm`, { force: true }), rm(`${databasePath}-wal`, { force: true })]);
    return databasePath;
};

const encodeWorkspace = (uri: string): number[] => {
    return encodeMessage(9, [...encodeString(1, uri), ...encodeString(2, uri), ...encodeString(4, 'main')]);
};

const encodeContext = (projectId: string, workspaceUri?: string): number[] => {
    return encodeMessage(17, [
        ...(workspaceUri ? encodeMessage(1, [...encodeString(1, workspaceUri), ...encodeString(2, workspaceUri)]) : []),
        ...encodeString(18, projectId),
    ]);
};

const encodeSummaryIndex = (summaries: SummaryFixture[]): Uint8Array => {
    const bytes = summaries.flatMap((summary) => {
        const summaryPayload = [
            ...encodeString(1, summary.title),
            ...encodeNumber(2, summary.indexedItemCount ?? 0),
            ...encodeTimestamp(3, summary.updatedAtSeconds ?? 1_700_000_200),
            ...encodeString(4, 'workspace-instance-id'),
            ...encodeNumber(5, 1),
            ...encodeTimestamp(7, summary.createdAtSeconds ?? 1_700_000_000),
            ...(summary.workspaceUri ? encodeWorkspace(summary.workspaceUri) : []),
            ...(summary.projectId ? encodeContext(summary.projectId, summary.workspaceUri) : []),
        ];

        return encodeMessage(1, [...encodeString(1, summary.id), ...encodeMessage(2, summaryPayload)]);
    });

    return new Uint8Array(bytes);
};

const makeRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'antigravity-fixture-'));
    await mkdir(path.join(root, 'conversations'), { recursive: true });
    await mkdir(path.join(root, 'brain'), { recursive: true });
    return root;
};

const mkdtemp = async (prefix: string) => {
    const { mkdtemp: makeTemp } = await import('node:fs/promises');
    return makeTemp(prefix);
};

const runGit = async (cwd: string, args: string[]): Promise<void> => {
    const process = Bun.spawn(['git', '-C', cwd, ...args], {
        stderr: 'pipe',
        stdout: 'pipe',
    });
    const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
    if (exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
    }
};

describe('antigravity db discovery', () => {
    it('should resolve one conversation without requiring a collection scan', async () => {
        const root = await makeRoot();
        const conversationId = '12111111-1111-4111-8111-111111111111';
        await Bun.write(path.join(root, 'conversations', `${conversationId}.pb`), new Uint8Array([1, 2, 3]));

        const conversation = await getAntigravityConversationById(conversationId, [root]);

        expect(conversation?.conversationId).toBe(conversationId);
        expect(conversation?.conversationBytes).toBe(3);
        expect(await getAntigravityConversationById('not-a-safe-id', [root])).toBeNull();
    });

    it('should discover conversations from the summary index, conversation files, and artifacts', async () => {
        const root = await makeRoot();
        const conversationId = '11111111-1111-4111-8111-111111111111';
        const artifactDir = path.join(root, 'brain', conversationId);
        await mkdir(artifactDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([
                {
                    createdAtSeconds: 1_700_000_000,
                    id: conversationId,
                    indexedItemCount: 7,
                    title: 'Fix checkout totals',
                    updatedAtSeconds: 1_700_000_500,
                    workspaceUri: 'file:///tmp/shop-app',
                },
            ]),
        );
        await Bun.write(path.join(root, 'conversations', `${conversationId}.pb`), new Uint8Array([1, 2, 3, 4]));
        await Bun.write(path.join(artifactDir, 'notes.md'), '# Notes\n\nImportant details.\n');
        await Bun.write(
            path.join(artifactDir, 'notes.md.metadata.json'),
            JSON.stringify({
                artifactType: 'ARTIFACT_TYPE_OTHER',
                summary: 'A generated implementation note.',
                updatedAt: '2026-05-13T02:21:49.156Z',
            }),
        );

        const conversations = await listAntigravityConversations([root]);

        expect(conversations).toHaveLength(1);
        expect(conversations[0]).toMatchObject({
            artifactCount: 1,
            conversationBytes: 4,
            conversationId,
            indexedItemCount: 7,
            title: 'Fix checkout totals',
            workspaceKey: 'folder:/tmp/shop-app',
            workspaceLabel: 'shop-app',
            workspaceUri: 'file:///tmp/shop-app',
        });
        expect(conversations[0]?.createdAtMs).toBe(1_700_000_000_123);
        expect(conversations[0]?.lastUpdatedAtMs).toBe(1_700_000_500_123);
        expect(conversations[0]?.artifacts[0]).toMatchObject({
            name: 'notes.md',
            summary: 'A generated implementation note.',
        });
    });

    it('should ignore artifact directories whose names are not safe conversation ids', async () => {
        const root = await makeRoot();
        const unsafeArtifactDir = path.join(root, 'brain', '..not-a-conversation-id');
        await mkdir(unsafeArtifactDir, { recursive: true });
        await Bun.write(path.join(unsafeArtifactDir, 'notes.md'), '# Notes\n');

        const conversations = await listAntigravityConversations([root]);

        expect(conversations).toEqual([]);
    });

    it('should group conversations by Antigravity workspace and keep unknown chats separate', async () => {
        const root = await makeRoot();
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([
                {
                    id: '22222222-2222-4222-8222-222222222222',
                    title: 'Project chat',
                    updatedAtSeconds: 1_700_000_700,
                    workspaceUri: 'file:///tmp/project-one',
                },
                {
                    id: '33333333-3333-4333-8333-333333333333',
                    title: 'Outside chat',
                    updatedAtSeconds: 1_700_000_800,
                },
            ]),
        );

        const groups = groupAntigravityConversations(await listAntigravityConversations([root]));

        expect(groups.map((group) => group.key)).toEqual(['unknown', 'folder:/tmp/project-one']);
        expect(groups[0]).toMatchObject({
            conversationCount: 1,
            label: 'Unknown project',
        });
        expect(groups[1]).toMatchObject({
            conversationCount: 1,
            label: 'project-one',
        });
    });

    it('should prefer Antigravity project assignment over a conflicting workspace URI', async () => {
        const root = await makeRoot();
        const projectId = '00ea3331-909e-4010-a208-78f964ecfb59';
        const conversationIds = [
            '4d04caff-d2d4-4bd1-b083-c4346029a095',
            '9bbac489-acfa-4d1f-877e-5defcbeb4741',
            '0f611134-0bb1-491e-8380-55d836a8c961',
        ];
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex(
                conversationIds.map((id) => ({
                    id,
                    projectId,
                    title: '### Findings',
                    workspaceUri: 'file:///tmp/ushman-replay',
                })),
            ),
        );

        const conversations = await listAntigravityConversations([root]);
        const groups = groupAntigravityConversations(conversations, new Map([[projectId, 'spiracha']]));

        expect(conversations.map((conversation) => conversation.projectId)).toEqual([projectId, projectId, projectId]);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            conversationCount: 3,
            key: `project:${projectId}`,
            label: 'spiracha',
            uri: null,
        });
    });

    it('should prefer newer conversation files when duplicate roots are present', async () => {
        const oldRoot = await makeRoot();
        const newRoot = await makeRoot();
        const conversationId = '44444444-4444-4444-8444-444444444444';
        const oldPath = path.join(oldRoot, 'conversations', `${conversationId}.pb`);
        const newPath = path.join(newRoot, 'conversations', `${conversationId}.pb`);
        await Bun.write(oldPath, new Uint8Array([1]));
        await Bun.write(newPath, new Uint8Array([1, 2, 3]));
        await utimes(oldPath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
        await utimes(newPath, new Date('2026-02-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));

        const [conversation] = await listAntigravityConversations([oldRoot, newRoot]);

        expect(conversation?.conversationPath).toBe(newPath);
        expect(conversation?.conversationBytes).toBe(3);
    });

    it('should render markdown exports for Antigravity brain artifacts', async () => {
        const root = await makeRoot();
        const conversationId = '55555555-5555-4555-8555-555555555555';
        const artifactDir = path.join(root, 'brain', conversationId);
        await mkdir(artifactDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Research notes' }]),
        );
        await Bun.write(path.join(artifactDir, 'research.md'), 'Findings go here.\n');

        const [conversation] = await listAntigravityConversations([root]);
        const markdown = await renderAntigravityArtifactsMarkdown(conversation!);

        expect(markdown).toContain('# Research notes');
        expect(markdown).toContain('conversation_id: `55555555-5555-4555-8555-555555555555`');
        expect(markdown).toContain('## research.md');
        expect(markdown).toContain('Findings go here.');
    });

    it('should discover and render Antigravity overview transcript logs', async () => {
        const root = await makeRoot();
        const conversationId = '66666666-6666-4666-8666-666666666666';
        const logsDir = path.join(root, 'brain', conversationId, '.system_generated', 'logs');
        await mkdir(logsDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Recover deleted sessions' }]),
        );
        await Bun.write(
            path.join(logsDir, 'overview.txt'),
            [
                JSON.stringify({
                    content:
                        '<USER_REQUEST>\nCan I recover deleted chats?\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nnoise\n</ADDITIONAL_METADATA>',
                    created_at: '2026-05-30T22:10:46Z',
                    source: 'USER_EXPLICIT',
                    status: 'DONE',
                    step_index: 0,
                    type: 'USER_INPUT',
                }),
                JSON.stringify({
                    content: 'I will inspect the local Antigravity data directory.',
                    created_at: '2026-05-30T22:10:47Z',
                    source: 'MODEL',
                    status: 'DONE',
                    step_index: 1,
                    tool_calls: [
                        {
                            args: { DirectoryPath: '/Users/example/.gemini/antigravity' },
                            name: 'list_dir',
                        },
                    ],
                    type: 'PLANNER_RESPONSE',
                }),
            ].join('\n'),
        );

        const [conversation] = await listAntigravityConversations([root]);
        const markdown = await renderAntigravityConversationMarkdown(conversation!);

        expect(conversation).toMatchObject({
            transcriptEntryCount: 2,
            transcriptSource: 'overview',
        });
        expect(markdown).toContain('# Recover deleted sessions');
        expect(markdown).toContain('- exported_from: `antigravity_overview_transcript`');
        expect(markdown).toContain(`- transcript_schema: \`${ANTIGRAVITY_TRANSCRIPT_MARKDOWN_VERSION}\``);
        expect(markdown).toContain('## User');
        expect(markdown).toContain('Can I recover deleted chats?');
        expect(markdown).not.toContain('ADDITIONAL_METADATA');
        expect(markdown).toContain('## Assistant');
        expect(markdown).toContain('I will inspect the local Antigravity data directory.');
        expect(markdown).toContain('### Tool Calls');
        expect(markdown).toContain('`list_dir`');
        const parsedEvents = antigravityMarkdownToThreadEvents(markdown);
        expect(parsedEvents).toContainEqual(
            expect.objectContaining({ kind: 'message', role: 'user', text: 'Can I recover deleted chats?' }),
        );
        expect(parsedEvents).toContainEqual(
            expect.objectContaining({
                argumentsText: expect.stringContaining('DirectoryPath'),
                kind: 'tool_call',
                name: 'list_dir',
            }),
        );
    });

    it('should prefer full Antigravity JSONL transcripts and include them in total size', async () => {
        const root = await makeRoot();
        const conversationId = '66666666-7777-4666-8666-666666666666';
        const logsDir = path.join(root, 'brain', conversationId, '.system_generated', 'logs');
        await mkdir(logsDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Full transcript session' }]),
        );
        await Bun.write(
            path.join(logsDir, 'transcript.jsonl'),
            JSON.stringify({
                content: 'Short transcript only.',
                created_at: '2026-05-30T22:10:47Z',
                source: 'MODEL',
                status: 'DONE',
                step_index: 1,
                type: 'PLANNER_RESPONSE',
            }),
        );
        const fullTranscriptPath = path.join(logsDir, 'transcript_full.jsonl');
        await Bun.write(
            fullTranscriptPath,
            [
                JSON.stringify({
                    content:
                        '<USER_REQUEST>Full transcript user message.</USER_REQUEST><USER_SETTINGS_CHANGE>The user changed setting `Model Selection` from None to Claude Sonnet 4.6 (Thinking). No need to comment.</USER_SETTINGS_CHANGE>',
                    created_at: '2026-05-30T22:10:46Z',
                    source: 'USER_EXPLICIT',
                    status: 'DONE',
                    step_index: 0,
                    type: 'USER_INPUT',
                }),
                JSON.stringify({
                    content: 'Full transcript assistant answer.',
                    created_at: '2026-05-30T22:10:47Z',
                    source: 'MODEL',
                    status: 'DONE',
                    step_index: 1,
                    type: 'PLANNER_RESPONSE',
                }),
            ].join('\n'),
        );

        const [conversation] = await listAntigravityConversations([root]);
        const markdown = await renderAntigravityConversationMarkdown(conversation!);
        const [group] = groupAntigravityConversations([conversation!]);

        expect(conversation).toMatchObject({
            model: 'Claude Sonnet 4.6',
            totalBytes: conversation!.transcriptBytes,
            transcriptEntryCount: 2,
            transcriptPath: fullTranscriptPath,
            transcriptSource: 'transcript',
        });
        expect(conversation!.transcriptBytes).toBeGreaterThan(0);
        expect(group?.totalBytes).toBe(conversation!.totalBytes);
        expect(markdown).toContain('Full transcript user message.');
        expect(markdown).toContain('_Model: Claude Sonnet 4.6_');
        expect(markdown).toContain('Full transcript assistant answer.');
        expect(markdown).not.toContain('Short transcript only.');
    });

    it('should restore a compacted Antigravity transcript prefix from artifact Git snapshots', async () => {
        const root = await makeRoot();
        const conversationId = '69696969-6969-4696-8696-696969696969';
        const artifactDir = path.join(root, 'brain', conversationId);
        const logsDir = path.join(artifactDir, '.system_generated', 'logs');
        const transcriptPath = path.join(logsDir, 'transcript_full.jsonl');
        await mkdir(logsDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Compacted transcript session' }]),
        );
        await Bun.write(
            transcriptPath,
            [
                JSON.stringify({
                    content: 'Original request before compaction.',
                    source: 'USER_EXPLICIT',
                    status: 'DONE',
                    step_index: 0,
                    type: 'USER_INPUT',
                }),
                JSON.stringify({
                    content: 'Stale assistant response.',
                    source: 'MODEL',
                    status: 'DONE',
                    step_index: 1,
                    type: 'PLANNER_RESPONSE',
                }),
            ].join('\n'),
        );
        await runGit(artifactDir, ['init', '--quiet']);
        await runGit(artifactDir, ['config', 'user.email', 'antigravity@example.test']);
        await runGit(artifactDir, ['config', 'user.name', 'Antigravity']);
        await runGit(artifactDir, ['add', '.system_generated/logs/transcript_full.jsonl']);
        await runGit(artifactDir, ['commit', '--quiet', '-m', 'Initial snapshot']);
        await Bun.write(
            transcriptPath,
            [
                JSON.stringify({
                    content: 'Original request before compaction.',
                    source: 'USER_EXPLICIT',
                    status: 'DONE',
                    step_index: 0,
                    type: 'USER_INPUT',
                }),
                JSON.stringify({
                    content: 'Revised assistant response.',
                    source: 'MODEL',
                    status: 'DONE',
                    step_index: 1,
                    type: 'PLANNER_RESPONSE',
                }),
                JSON.stringify({
                    content: 'Last message before compaction.',
                    source: 'MODEL',
                    status: 'DONE',
                    step_index: 2,
                    type: 'PLANNER_RESPONSE',
                }),
            ].join('\n'),
        );
        await runGit(artifactDir, ['add', '.system_generated/logs/transcript_full.jsonl']);
        await runGit(artifactDir, ['commit', '--quiet', '-m', 'Pre-compaction snapshot']);
        await Bun.write(
            transcriptPath,
            [
                JSON.stringify({
                    content: 'Current request after compaction.',
                    source: 'USER_EXPLICIT',
                    status: 'DONE',
                    step_index: 3,
                    type: 'USER_INPUT',
                }),
                JSON.stringify({
                    content: 'Current assistant response.',
                    source: 'MODEL',
                    status: 'DONE',
                    step_index: 4,
                    type: 'PLANNER_RESPONSE',
                }),
            ].join('\n'),
        );

        const conversation = await getAntigravityConversationById(conversationId, [root]);
        const messages = await readAntigravityConversationMessages(conversation!);
        const markdown = await renderAntigravityConversationMarkdown(conversation!);

        expect(messages.map((message) => message.text)).toEqual([
            'Original request before compaction.',
            'Revised assistant response.',
            'Last message before compaction.',
            'Current request after compaction.',
            'Current assistant response.',
        ]);
        expect(messages.map((message) => message.order)).toEqual([0, 1, 2, 3, 4]);
        expect(messages.map((message) => message.text)).not.toContain('Stale assistant response.');
        expect(markdown).toContain('Original request before compaction.');
        expect(markdown).toContain('Current assistant response.');
        expect(markdown).not.toContain('Stale assistant response.');
    });

    it('should merge complete SQLite trajectory commands, outputs, and reasoning into UI and export transcripts', async () => {
        const root = await makeRoot();
        const conversationId = '67676767-6767-4676-8676-676767676767';
        const logsDir = path.join(root, 'brain', conversationId, '.system_generated', 'logs');
        await mkdir(logsDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Trajectory transcript session' }]),
        );
        const databasePath = await writeTrajectoryDatabase(root, conversationId);
        await Bun.write(
            path.join(logsDir, 'transcript_full.jsonl'),
            JSON.stringify({
                content: 'Generated-only event retained during trajectory merge.',
                created_at: '2026-07-22T05:00:00Z',
                source: 'SYSTEM',
                status: 'DONE',
                step_index: 6,
                type: 'SYSTEM_MESSAGE',
            }),
        );

        const conversation = await getAntigravityConversationById(conversationId, [root]);
        const markdown = await renderAntigravityConversationMarkdown(conversation!, {
            includeCommentary: true,
            includeTools: true,
        });
        const text = await renderAntigravityConversationMarkdown(conversation!, {
            includeCommentary: true,
            includeTools: true,
            outputFormat: 'txt',
        });
        const messages = await readAntigravityConversationMessages(conversation!);
        const events = antigravityMarkdownToThreadEvents(markdown);

        expect(conversation).toMatchObject({
            conversationPath: databasePath,
            transcriptEntryCount: 8,
            transcriptSource: 'trajectory',
        });
        expect(markdown).toContain('Generated-only event retained during trajectory merge.');
        expect(markdown).toContain('command -v kodeguard && kodeguard capabilities --json');
        expect(markdown).toContain('/Users/example/.bun/bin/kodeguard');
        expect(markdown).toContain('kodeguard/capabilities/v13');
        expect(markdown).toContain(
            'kodeguard drive probe src/cleanup-briefs/apply-decompose.ts --profile decomposition --json',
        );
        expect(markdown).toContain('Confirming Test Drive Success');
        expect(text).toContain('Exit code: 0');
        expect(messages).toContainEqual(
            expect.objectContaining({
                metadata: expect.objectContaining({ toolCallId: 'call-capabilities' }),
                phase: 'tool_output',
                text: expect.stringContaining('kodeguard/capabilities/v13'),
            }),
        );
        expect(events).toContainEqual(
            expect.objectContaining({
                callId: 'call-capabilities',
                command: 'command -v kodeguard && kodeguard capabilities --json',
                kind: 'tool_call',
                workdir: '/Users/example/workspace/ushman',
            }),
        );
        expect(events).toContainEqual(
            expect.objectContaining({
                callId: 'call-capabilities',
                exitCode: 0,
                kind: 'tool_output',
                outputText: expect.stringContaining('kodeguard/capabilities/v13'),
            }),
        );
        expect(events).toContainEqual(
            expect.objectContaining({
                kind: 'message',
                phase: 'commentary',
                text: expect.stringContaining('Confirming Test Drive Success'),
            }),
        );
        expect(events).toContainEqual(
            expect.objectContaining({
                kind: 'message',
                phase: 'commentary',
                text: expect.stringContaining('Clarifying Workflow Steps'),
            }),
        );
        expect(
            await renderAntigravityConversationMarkdown(conversation!, {
                includeCommentary: false,
                includeTools: false,
            }),
        ).not.toContain('Confirming Test Drive Success');
    });

    it('should render Antigravity operation results as tool output sections', async () => {
        const root = await makeRoot();
        const conversationId = '99999999-9999-4999-8999-999999999999';
        const logsDir = path.join(root, 'brain', conversationId, '.system_generated', 'logs');
        await mkdir(logsDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Review docs' }]),
        );
        await Bun.write(
            path.join(logsDir, 'transcript.jsonl'),
            [
                JSON.stringify({
                    content: 'Review README.md',
                    created_at: '2026-06-07T03:10:02Z',
                    source: 'USER_EXPLICIT',
                    status: 'DONE',
                    step_index: 0,
                    type: 'USER_INPUT',
                }),
                JSON.stringify({
                    content: 'Created At: 2026-06-07T03:10:07Z\nFile Path: `file://README.md`\n1: # Demo',
                    created_at: '2026-06-07T03:10:07Z',
                    source: 'MODEL',
                    status: 'DONE',
                    step_index: 1,
                    type: 'VIEW_FILE',
                }),
            ].join('\n'),
        );

        const [conversation] = await listAntigravityConversations([root]);
        const markdown = await renderAntigravityConversationMarkdown(conversation!);

        expect(markdown).toContain('## Tool: VIEW_FILE');
        expect(markdown).toContain('File Path: `file://README.md`');
        expect(markdown).not.toContain('## Assistant\n\n_Timestamp: 2026-06-07T03:10:07Z_');
    });

    it('should honor transcript export options for metadata, commentary, tools, and plain text', async () => {
        const root = await makeRoot();
        const conversationId = '99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const logsDir = path.join(root, 'brain', conversationId, '.system_generated', 'logs');
        await mkdir(logsDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Audit exports' }]),
        );
        await Bun.write(
            path.join(logsDir, 'transcript.jsonl'),
            [
                JSON.stringify({
                    content: 'Audit the export path.',
                    source: 'USER_EXPLICIT',
                    type: 'USER_INPUT',
                }),
                JSON.stringify({
                    content: 'Inspecting the export path.',
                    source: 'MODEL',
                    thinking: 'Inspecting the renderer.',
                    tool_calls: [{ args: { path: 'src/index.ts' }, name: 'view_file' }],
                    type: 'PLANNER_RESPONSE',
                }),
                JSON.stringify({
                    content: 'Hidden tool output',
                    source: 'MODEL',
                    type: 'VIEW_FILE',
                }),
                JSON.stringify({
                    content: 'The export path is fixed.',
                    source: 'MODEL',
                    type: 'PLANNER_RESPONSE',
                }),
            ].join('\n'),
        );

        const [conversation] = await listAntigravityConversations([root]);
        const messages = await readAntigravityConversationMessages(conversation!);
        const text = await renderAntigravityConversationMarkdown(conversation!, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });

        expect(text).toContain('Audit exports\n=============');
        expect(text).toContain('User\n----\nAudit the export path.');
        expect(text).toContain('Assistant\n---------\nThe export path is fixed.');
        expect(text).not.toContain('Inspecting the export path.');
        expect(text).not.toContain('exported_from');
        expect(text).not.toContain('Inspecting the renderer.');
        expect(text).not.toContain('view_file');
        expect(text).not.toContain('Hidden tool output');
        expect(text).not.toContain('#');
        expect(text).not.toContain('`');
        expect(
            messages
                .filter((message) => message.role === 'assistant' && message.phase !== 'reasoning')
                .map((message) => ({ phase: message.phase, text: message.text })),
        ).toEqual([
            { phase: 'commentary', text: 'Inspecting the export path.' },
            { phase: 'final_answer', text: 'The export path is fixed.' },
        ]);
    });

    it('should surface corrupt transcripts during explicit conversation reads', async () => {
        const root = await makeRoot();
        const conversationId = '99999999-aaaa-4aaa-8aaa-bbbbbbbbbbbb';
        const logsDir = path.join(root, 'brain', conversationId, '.system_generated', 'logs');
        await mkdir(logsDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Corrupt transcript' }]),
        );
        await Bun.write(path.join(logsDir, 'transcript.jsonl'), '{not-json');
        const [conversation] = await listAntigravityConversations([root]);

        await expect(readAntigravityConversationMessages(conversation!)).rejects.toThrow('corrupt');
    });

    it('should derive a workspace group from the source root when a conversation has no summary metadata', async () => {
        const root = await makeRoot();
        const conversationId = '77777777-7777-4777-8777-777777777777';
        await Bun.write(path.join(root, 'conversations', `${conversationId}.pb`), new Uint8Array([1, 2, 3]));

        const [conversation] = await listAntigravityConversations([root]);

        expect(conversation).toMatchObject({
            conversationId,
            workspaceKey: `folder:${root}`,
            workspaceLabel: path.basename(root),
        });
    });

    it('should not treat artifacts as conversation transcript markdown', async () => {
        const root = await makeRoot();
        const conversationId = '88888888-8888-4888-8888-888888888888';
        const artifactDir = path.join(root, 'brain', conversationId);
        await mkdir(artifactDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Artifact only session' }]),
        );
        await Bun.write(path.join(artifactDir, 'artifact.md'), 'Only artifact content.\n');

        const [conversation] = await listAntigravityConversations([root]);
        const markdown = await renderAntigravityConversationMarkdown(conversation!);

        expect(markdown).toBeNull();
    });

    it('should render summary-only Antigravity conversations as exportable metadata', async () => {
        const root = await makeRoot();
        const conversationId = '88888888-9999-4888-8888-888888888888';
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([
                {
                    id: conversationId,
                    indexedItemCount: 5,
                    title: 'Summary only review',
                    workspaceUri: 'file:///tmp/summary-workspace',
                },
            ]),
        );

        const [conversation] = await listAntigravityConversations([root]);
        const markdown = await renderAntigravityConversationMarkdown(conversation!);

        expect(conversation).toMatchObject({
            totalBytes: 0,
            transcriptSource: null,
        });
        expect(markdown).toContain('# Summary only review');
        expect(markdown).toContain('- exported_from: `antigravity_summary_index`');
        expect(markdown).toContain('- indexed_items: `5`');
    });

    it('should delete an Antigravity conversation from summaries, databases, transcripts, and artifacts', async () => {
        const root = await makeRoot();
        const deletedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const retainedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const deletedArtifactDir = path.join(root, 'brain', deletedId);
        const deletedLogsDir = path.join(deletedArtifactDir, '.system_generated', 'logs');
        const deletedConversationPath = path.join(root, 'conversations', `${deletedId}.pb`);
        const deletedDatabasePath = path.join(root, 'conversations', `${deletedId}.db`);
        const deletedDatabaseShmPath = `${deletedDatabasePath}-shm`;
        const deletedDatabaseWalPath = `${deletedDatabasePath}-wal`;
        const deletedTranscriptPath = path.join(deletedLogsDir, 'overview.txt');
        const deletedFullTranscriptPath = path.join(deletedLogsDir, 'transcript_full.jsonl');
        await mkdir(deletedLogsDir, { recursive: true });
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([
                { id: deletedId, title: 'Delete me', workspaceUri: 'file:///tmp/delete-me' },
                { id: retainedId, title: 'Keep me', workspaceUri: 'file:///tmp/keep-me' },
            ]),
        );
        await Bun.write(deletedConversationPath, new Uint8Array([1, 2, 3]));
        await Bun.write(deletedDatabasePath, new Uint8Array([4, 5, 6]));
        await Bun.write(deletedDatabaseShmPath, new Uint8Array([7]));
        await Bun.write(deletedDatabaseWalPath, new Uint8Array([8]));
        await Bun.write(deletedTranscriptPath, '{}\n');
        await Bun.write(deletedFullTranscriptPath, '{}\n');
        await Bun.write(path.join(deletedArtifactDir, 'artifact.md'), 'Generated artifact.\n');
        await Bun.write(path.join(root, 'conversations', `${retainedId}.pb`), new Uint8Array([4, 5]));

        const result = await deleteAntigravityConversation([root], deletedId);

        expect(result.deletedConversationIds).toEqual([deletedId]);
        expect(result.deletedPaths.sort()).toEqual(
            [
                deletedArtifactDir,
                deletedConversationPath,
                deletedDatabasePath,
                deletedDatabaseShmPath,
                deletedDatabaseWalPath,
                deletedFullTranscriptPath,
                deletedTranscriptPath,
            ].sort(),
        );
        expect(await Bun.file(deletedConversationPath).exists()).toBe(false);
        expect(await Bun.file(deletedDatabasePath).exists()).toBe(false);
        expect(await Bun.file(deletedDatabaseShmPath).exists()).toBe(false);
        expect(await Bun.file(deletedDatabaseWalPath).exists()).toBe(false);
        expect(await Bun.file(deletedTranscriptPath).exists()).toBe(false);
        expect(await Bun.file(deletedFullTranscriptPath).exists()).toBe(false);
        expect(await Bun.file(path.join(deletedArtifactDir, 'artifact.md')).exists()).toBe(false);

        const conversations = await listAntigravityConversations([root]);
        expect(conversations.map((conversation) => conversation.conversationId)).toEqual([retainedId]);
    });

    it('should replace a read-only Antigravity summary index atomically', async () => {
        const root = await makeRoot();
        const deletedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const retainedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const summaryPath = path.join(root, 'agyhub_summaries_proto.pb');
        await Bun.write(
            summaryPath,
            encodeSummaryIndex([
                { id: deletedId, title: 'Delete me', workspaceUri: 'file:///tmp/delete-me' },
                { id: retainedId, title: 'Keep me', workspaceUri: 'file:///tmp/keep-me' },
            ]),
        );
        await chmod(summaryPath, 0o444);

        const result = await deleteAntigravityConversation([root], deletedId);

        expect(result.deletedConversationIds).toEqual([deletedId]);
        const summaries = await listAntigravityConversations([root]);
        expect(summaries.map((conversation) => conversation.conversationId)).toEqual([retainedId]);
    });
});
