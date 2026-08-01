import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteClineTask,
    getDefaultClineGlobalStorageDir,
    listClineTasksForGroup,
    listClineWorkspaceGroups,
    readClineTaskTranscript,
} from './cline-db';
import { CLINE_TASK_ID, writeClineTaskFixture } from './cline-test-helpers';
import { renderClineTranscript } from './cline-transcript';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cline-db-test-'));
    tempRoots.push(root);
    return root;
};

describe('Cline task storage', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should resolve platform-specific VS Code global storage defaults', () => {
        expect(getDefaultClineGlobalStorageDir({}, '/home/tester', 'linux')).toBe(
            '/home/tester/.config/Code/User/globalStorage/saoudrizwan.claude-dev',
        );
        expect(getDefaultClineGlobalStorageDir({ XDG_CONFIG_HOME: '/config' }, '/home/tester', 'linux')).toBe(
            '/config/Code/User/globalStorage/saoudrizwan.claude-dev',
        );
        expect(getDefaultClineGlobalStorageDir({}, '/Users/tester', 'darwin')).toBe(
            '/Users/tester/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev',
        );
        expect(
            getDefaultClineGlobalStorageDir(
                { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
                'C:\\Users\\test',
                'win32',
            ),
        ).toContain('saoudrizwan.claude-dev');
    });

    it('should discover Cline tasks from task history and visible UI messages', async () => {
        const root = await makeTempRoot();
        const workspacePath = path.join(root, 'repo');
        const globalStorageDir = path.join(root, 'saoudrizwan.claude-dev');
        await writeClineTaskFixture({ globalStorageDir, workspacePath });

        const groups = await listClineWorkspaceGroups(globalStorageDir);
        expect(groups).toEqual([
            expect.objectContaining({
                assistantMessageCount: 2,
                label: 'repo',
                messageCount: 3,
                reasoningCount: 1,
                taskCount: 1,
                toolCallCount: 2,
                toolResultCount: 2,
                worktree: workspacePath,
            }),
        ]);

        const tasks = await listClineTasksForGroup(groups[0]!.key, globalStorageDir);
        expect(tasks).toEqual([
            expect.objectContaining({
                isFavorited: true,
                modelId: 'anthropic/claude-sonnet-4',
                taskId: CLINE_TASK_ID,
                title: 'Fix issue 1494 per the implementation plan',
                worktree: workspacePath,
            }),
        ]);
    });

    it('should parse user, reasoning, commentary, command, tool, and final-answer events', async () => {
        const root = await makeTempRoot();
        const workspacePath = path.join(root, 'repo');
        const globalStorageDir = path.join(root, 'saoudrizwan.claude-dev');
        await writeClineTaskFixture({ globalStorageDir, workspacePath });

        const transcript = await readClineTaskTranscript(globalStorageDir, CLINE_TASK_ID);
        expect(transcript?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Fix issue 1494 per the implementation plan' },
            {
                phase: 'reasoning',
                role: 'assistant',
                text: 'I need to inspect the protected surface policy first.',
            },
            { phase: 'commentary', role: 'assistant', text: 'I will inspect the relevant files.' },
            {
                phase: 'tool_call',
                role: 'assistant',
                text: 'bun test src/vendor-proof-lifecycle.test.ts',
            },
            { phase: 'tool_output', role: 'tool', text: '57 pass\n0 fail' },
            {
                phase: 'tool_call',
                role: 'assistant',
                text: expect.stringContaining('readFile'),
            },
            { phase: 'tool_output', role: 'tool', text: 'const result = true;' },
            {
                phase: 'final_answer',
                role: 'assistant',
                text: 'Implemented the 1494 fix per 1494-PLAN.md.',
            },
        ]);
        expect(transcript?.messages.find((message) => message.phase === 'tool_call')?.tool).toMatchObject({
            command: 'bun test src/vendor-proof-lifecycle.test.ts',
            name: 'execute_command',
            status: 'succeeded',
            workdir: workspacePath,
        });
    });

    it('should delete the task directory and its task-history record', async () => {
        const root = await makeTempRoot();
        const workspacePath = path.join(root, 'repo');
        const globalStorageDir = path.join(root, 'saoudrizwan.claude-dev');
        const fixture = await writeClineTaskFixture({ globalStorageDir, workspacePath });

        const result = await deleteClineTask(globalStorageDir, CLINE_TASK_ID);

        expect(result.deletedTaskIds).toEqual([CLINE_TASK_ID]);
        expect(result.deletedFiles).toContain(fixture.taskDir);
        expect(await Bun.file(fixture.uiMessagesPath).exists()).toBe(false);
        expect(await Bun.file(fixture.taskHistoryPath).json()).toEqual([]);
    });

    it('should render Markdown and plain-text exports with configurable sections', async () => {
        const root = await makeTempRoot();
        const globalStorageDir = path.join(root, 'saoudrizwan.claude-dev');
        await writeClineTaskFixture({ globalStorageDir, workspacePath: path.join(root, 'repo') });
        const transcript = await readClineTaskTranscript(globalStorageDir, CLINE_TASK_ID);
        expect(transcript).not.toBeNull();

        const markdown = renderClineTranscript(transcript!, {
            includeCommentary: false,
            includeMetadata: true,
            includeTools: false,
            outputFormat: 'md',
        });
        expect(markdown).toContain('# Fix issue 1494 per the implementation plan');
        expect(markdown).toContain('exported_from: "cline_ui_messages"');
        expect(markdown).toContain('## Assistant (Final)');
        expect(markdown).not.toContain('protected surface policy');
        expect(markdown).not.toContain('Tool Call');

        const text = renderClineTranscript(transcript!, {
            includeCommentary: true,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
        });
        expect(text).toContain('Fix issue 1494 per the implementation plan\n');
        expect(text).toContain('Tool Call\n---------');
        expect(text).not.toContain('exported_from:');
    });

    it('should return empty results for malformed task keys and missing storage', async () => {
        const root = await makeTempRoot();
        const globalStorageDir = path.join(root, 'missing');
        await expect(listClineWorkspaceGroups(globalStorageDir)).resolves.toEqual([]);
        await expect(listClineTasksForGroup('invalid', globalStorageDir)).resolves.toEqual([]);
        await expect(readClineTaskTranscript(globalStorageDir, '../unsafe')).resolves.toBeNull();
        await expect(deleteClineTask(globalStorageDir, '../unsafe')).resolves.toEqual({
            deletedFiles: [],
            deletedTaskIds: [],
        });
    });
});
