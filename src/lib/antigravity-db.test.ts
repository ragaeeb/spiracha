import { describe, expect, it } from 'bun:test';
import { mkdir, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    groupAntigravityConversations,
    listAntigravityConversations,
    renderAntigravityArtifactsMarkdown,
    renderAntigravityConversationMarkdown,
} from './antigravity-db';

type SummaryFixture = {
    id: string;
    title: string;
    indexedItemCount?: number;
    createdAtSeconds?: number;
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

const encodeWorkspace = (uri: string): number[] => {
    return encodeMessage(9, [...encodeString(1, uri), ...encodeString(2, uri), ...encodeString(4, 'main')]);
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

describe('antigravity db discovery', () => {
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
        expect(markdown).toContain('## User');
        expect(markdown).toContain('Can I recover deleted chats?');
        expect(markdown).not.toContain('ADDITIONAL_METADATA');
        expect(markdown).toContain('## Assistant');
        expect(markdown).toContain('I will inspect the local Antigravity data directory.');
        expect(markdown).toContain('### Tool Calls');
        expect(markdown).toContain('`list_dir`');
    });
});
