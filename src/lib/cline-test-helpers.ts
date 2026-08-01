import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const CLINE_TASK_ID = '1785560414951';

const writeJson = async (filePath: string, value: unknown) => {
    await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeClineTaskFixture = async ({
    globalStorageDir,
    taskId = CLINE_TASK_ID,
    workspacePath,
}: {
    globalStorageDir: string;
    taskId?: string;
    workspacePath: string;
}) => {
    const stateDir = path.join(globalStorageDir, 'state');
    const taskDir = path.join(globalStorageDir, 'tasks', taskId);
    await mkdir(stateDir, { recursive: true });
    await mkdir(taskDir, { recursive: true });

    const taskHistoryPath = path.join(stateDir, 'taskHistory.json');
    await writeJson(taskHistoryPath, [
        {
            cacheReads: 42,
            cacheWrites: 3,
            cwdOnTaskInitialization: workspacePath,
            id: taskId,
            isFavorited: true,
            modelId: 'anthropic/claude-sonnet-4',
            size: 2048,
            task: 'Fix issue 1494 per the implementation plan',
            tokensIn: 1200,
            tokensOut: 300,
            totalCost: 0.42,
            ts: 1_785_563_068_465,
            ulid: '01KYXV3EQ80Z2NJH1SV27GXS9J',
        },
    ]);

    const uiMessagesPath = path.join(taskDir, 'ui_messages.json');
    await writeJson(uiMessagesPath, [
        {
            conversationHistoryIndex: -1,
            files: [],
            images: [],
            say: 'task',
            text: 'Fix issue 1494 per the implementation plan',
            ts: 1_785_560_414_954,
            type: 'say',
        },
        {
            conversationHistoryIndex: 0,
            say: 'reasoning',
            text: 'I need to inspect the protected surface policy first.',
            ts: 1_785_560_418_335,
            type: 'say',
        },
        {
            conversationHistoryIndex: 0,
            say: 'text',
            text: 'I will inspect the relevant files.',
            ts: 1_785_560_419_303,
            type: 'say',
        },
        {
            commandCompleted: true,
            conversationHistoryIndex: 1,
            say: 'command',
            text: 'bun test src/vendor-proof-lifecycle.test.ts',
            ts: 1_785_560_450_947,
            type: 'say',
        },
        {
            ask: 'command_output',
            conversationHistoryIndex: 2,
            text: '57 pass\n0 fail',
            ts: 1_785_560_457_986,
            type: 'ask',
        },
        {
            conversationHistoryIndex: 3,
            say: 'tool',
            text: JSON.stringify({
                content: 'const result = true;',
                path: path.join(workspacePath, 'src', 'vendor-proof-lifecycle.ts'),
                tool: 'readFile',
            }),
            ts: 1_785_560_462_794,
            type: 'say',
        },
        {
            conversationHistoryIndex: 4,
            modelInfo: {
                mode: 'act',
                modelId: 'anthropic/claude-sonnet-4',
                providerId: 'cline',
            },
            say: 'completion_result',
            text: 'Implemented the 1494 fix per 1494-PLAN.md.',
            ts: 1_785_563_068_163,
            type: 'say',
        },
    ]);

    await writeJson(path.join(taskDir, 'api_conversation_history.json'), [
        { content: [{ text: 'Fix issue 1494', type: 'text' }], role: 'user', ts: 1_785_560_416_461 },
    ]);
    await writeJson(path.join(taskDir, 'task_metadata.json'), { environment_history: [], files_in_context: [] });

    return { taskDir, taskHistoryPath, taskId, uiMessagesPath };
};
