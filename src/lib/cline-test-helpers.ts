import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const CLINE_SESSION_ID = '1785560414951_demo';

const writeJson = async (filePath: string, value: unknown) => {
    await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeClineSessionFixture = async ({
    dataDir,
    sessionId = CLINE_SESSION_ID,
    title = 'Fix issue 1494 per the implementation plan',
    workspacePath,
}: {
    dataDir: string;
    sessionId?: string;
    title?: string;
    workspacePath: string;
}) => {
    const sessionDir = path.join(dataDir, 'sessions', sessionId);
    await mkdir(sessionDir, { recursive: true });

    const messagesPath = path.join(sessionDir, `${sessionId}.messages.json`);
    await writeJson(path.join(sessionDir, `${sessionId}.json`), {
        cwd: workspacePath,
        ended_at: '2026-08-08T00:00:02.000Z',
        metadata: {
            cacheReads: 42,
            cacheWrites: 3,
            isFavorited: true,
            modelId: 'deepseek/deepseek-v4-flash',
            size: 2048,
            title,
            tokensIn: 1200,
            tokensOut: 300,
            totalCost: 0.42,
        },
        model: 'deepseek/deepseek-v4-flash',
        prompt: title,
        session_id: sessionId,
        source: 'vscode',
        started_at: '2026-08-08T00:00:00.000Z',
        status: 'completed',
        version: 1,
        workspace_root: workspacePath,
    });
    await writeJson(messagesPath, {
        agent: 'lead',
        messages: [
            {
                content: [{ text: title, type: 'text' }],
                id: `${sessionId}-user`,
                role: 'user',
                ts: 1_786_147_200_000,
            },
            {
                content: [
                    { thinking: 'I need to inspect the protected surface policy first.', type: 'thinking' },
                    { text: 'I will inspect the relevant files.', type: 'text' },
                    {
                        id: `${sessionId}-tool-1`,
                        input: { commands: ['bun test src/vendor-proof-lifecycle.test.ts'] },
                        name: 'run_commands',
                        type: 'tool_use',
                    },
                ],
                id: `${sessionId}-assistant-1`,
                role: 'assistant',
                ts: 1_786_147_201_000,
            },
            {
                content: [
                    {
                        content: [{ result: '57 pass\n0 fail', success: true }],
                        name: 'run_commands',
                        tool_use_id: `${sessionId}-tool-1`,
                        type: 'tool_result',
                    },
                ],
                id: `${sessionId}-tool-result-1`,
                role: 'user',
                ts: 1_786_147_202_000,
            },
            {
                content: [{ text: `Implemented ${title}.`, type: 'text' }],
                id: `${sessionId}-assistant-2`,
                role: 'assistant',
                ts: 1_786_147_203_000,
            },
        ],
        sessionId,
        updated_at: '2026-08-08T00:00:02.000Z',
        version: 1,
    });

    return { messagesPath, sessionDir, sessionId };
};
