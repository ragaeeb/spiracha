import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listConversationsForPath } from '.';

type SummaryFixture = {
    id: string;
    title: string;
    workspaceUri: string;
};

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'antigravity-adapter-test-'));
    tempRoots.push(root);
    await mkdir(path.join(root, 'conversations'), { recursive: true });
    await mkdir(path.join(root, 'brain'), { recursive: true });
    return root;
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
    return encodeMessage(fieldNumber, [...encodeNumber(1, seconds), ...encodeNumber(2, 0)]);
};

const encodeWorkspace = (uri: string): number[] => {
    return encodeMessage(9, [...encodeString(1, uri), ...encodeString(2, uri)]);
};

const encodeSummaryIndex = (summaries: SummaryFixture[]): Uint8Array => {
    const bytes = summaries.flatMap((summary) => {
        const summaryPayload = [
            ...encodeString(1, summary.title),
            ...encodeNumber(2, 0),
            ...encodeTimestamp(3, 1_781_715_000),
            ...encodeTimestamp(7, 1_781_714_000),
            ...encodeWorkspace(summary.workspaceUri),
        ];

        return encodeMessage(1, [...encodeString(1, summary.id), ...encodeMessage(2, summaryPayload)]);
    });

    return new Uint8Array(bytes);
};

const writeAntigravityTranscript = async (
    root: string,
    conversationId: string,
    entries: readonly Record<string, unknown>[],
) => {
    const logsDir = path.join(root, 'brain', conversationId, '.system_generated', 'logs');
    await mkdir(logsDir, { recursive: true });
    const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
    await Bun.write(path.join(logsDir, 'transcript.jsonl'), content);
    await Bun.write(path.join(logsDir, 'transcript_full.jsonl'), content);
};

describe('antigravity conversation adapter', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should expose only the last assistant answer for collection and derive the Gemini model name', async () => {
        const root = await makeTempRoot();
        const project = path.join(root, 'project');
        await mkdir(project, { recursive: true });
        const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([
                {
                    id: conversationId,
                    title: 'Unhandled Optional Chaining in Manifest',
                    workspaceUri: `file://${project}`,
                },
            ]),
        );
        await writeAntigravityTranscript(root, conversationId, [
            {
                content:
                    '<USER_REQUEST>Review this project</USER_REQUEST><USER_SETTINGS_CHANGE>The user changed setting `Model Selection` from None to Gemini 3.1 Pro (High). No need to comment.</USER_SETTINGS_CHANGE>',
                created_at: '2026-06-17T16:00:00Z',
                source: 'USER_EXPLICIT',
                status: 'DONE',
                step_index: 0,
                type: 'USER_INPUT',
            },
            {
                content: 'Created At: 2026-06-17T16:00:01Z\nFile Path: `file://README.md`',
                created_at: '2026-06-17T16:00:01Z',
                source: 'MODEL',
                status: 'DONE',
                step_index: 1,
                type: 'VIEW_FILE',
            },
            {
                content: 'First draft answer that should not be selected.',
                created_at: '2026-06-17T16:00:02Z',
                source: 'MODEL',
                status: 'DONE',
                step_index: 2,
                type: 'PLANNER_RESPONSE',
            },
            {
                content: 'I will inspect the manifest before answering.',
                created_at: '2026-06-17T16:00:03Z',
                source: 'MODEL',
                status: 'DONE',
                step_index: 3,
                tool_calls: [{ args: { AbsolutePath: '/tmp/project/README.md' }, name: 'view_file' }],
                type: 'PLANNER_RESPONSE',
            },
            {
                content: 'Final answer with Unhandled Optional Chaining in Manifest.',
                created_at: '2026-06-17T16:00:04Z',
                source: 'MODEL',
                status: 'DONE',
                step_index: 4,
                type: 'PLANNER_RESPONSE',
            },
        ]);

        const page = await listConversationsForPath({
            cwd: project,
            includeMessages: true,
            locations: { antigravityRoots: [root] },
            messageSelector: 'last_final_answer',
            sources: ['antigravity'],
        });

        expect(page.data).toHaveLength(1);
        expect(page.data[0]?.metadata.model).toBe('Gemini 3.1 Pro');
        expect(page.data[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'final_answer',
                role: 'assistant',
                text: 'Final answer with Unhandled Optional Chaining in Manifest.',
            }),
        ]);
    });

    it('should match conversations that explicitly reference the requested project path', async () => {
        const root = await makeTempRoot();
        const requestedProject = path.join(root, 'requested-project');
        const antigravityWorkspace = path.join(root, 'other-workspace');
        await mkdir(path.join(requestedProject, 'src'), { recursive: true });
        await mkdir(antigravityWorkspace, { recursive: true });
        await Bun.write(path.join(requestedProject, 'src/index.ts'), 'export {};');
        const conversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([
                {
                    id: conversationId,
                    title: 'Reviewing Requested Project',
                    workspaceUri: `file://${antigravityWorkspace}`,
                },
            ]),
        );
        await writeAntigravityTranscript(root, conversationId, [
            {
                content: `Please review ${path.join(requestedProject, 'src/index.ts')}`,
                created_at: '2026-06-17T16:00:00Z',
                source: 'USER_EXPLICIT',
                status: 'DONE',
                step_index: 0,
                type: 'USER_INPUT',
            },
            {
                content: 'Final answer for requested project.',
                created_at: '2026-06-17T16:00:01Z',
                source: 'MODEL',
                status: 'DONE',
                step_index: 1,
                type: 'PLANNER_RESPONSE',
            },
        ]);

        const page = await listConversationsForPath({
            cwd: requestedProject,
            includeMessages: true,
            locations: { antigravityRoots: [root] },
            messageSelector: 'last_final_answer',
            sources: ['antigravity'],
        });

        expect(page.data).toHaveLength(1);
        expect(page.data[0]?.matches).toEqual([
            expect.objectContaining({
                kind: 'descendant',
            }),
        ]);
        expect(page.data[0]?.matches[0]?.candidatePath?.endsWith('/requested-project/src/index.ts')).toBe(true);
        expect(page.data[0]?.workspacePath).toBe(antigravityWorkspace);
        expect(page.data[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'final_answer',
                role: 'assistant',
                text: 'Final answer for requested project.',
            }),
        ]);
    });

    it('should assign unique ids when transcript entries reuse a step index and phase', async () => {
        const root = await makeTempRoot();
        const project = path.join(root, 'project');
        await mkdir(project, { recursive: true });
        const conversationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        await Bun.write(
            path.join(root, 'agyhub_summaries_proto.pb'),
            encodeSummaryIndex([{ id: conversationId, title: 'Duplicate steps', workspaceUri: `file://${project}` }]),
        );
        await writeAntigravityTranscript(root, conversationId, [
            { content: 'First user input', source: 'USER_EXPLICIT', step_index: 0, type: 'USER_INPUT' },
            { content: 'Second user input', source: 'USER_EXPLICIT', step_index: 0, type: 'USER_INPUT' },
            { content: 'Final answer', source: 'MODEL', step_index: 1, type: 'PLANNER_RESPONSE' },
        ]);

        const page = await listConversationsForPath({
            cwd: project,
            includeMessages: true,
            locations: { antigravityRoots: [root] },
            messageSelector: 'all',
            sources: ['antigravity'],
        });
        const ids = page.data[0]?.messages.map((message) => message.id) ?? [];

        expect(new Set(ids).size).toBe(ids.length);
    });
});
