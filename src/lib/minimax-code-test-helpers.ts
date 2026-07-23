import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const MINIMAX_CODE_SESSION_ID = 'mvs_08a9fc9128b443a7b5cc92bc690ca37b';
export const MINIMAX_CODE_WORKSPACE_KEY_PREFIX = 'workspace:';

const writeJson = async (filePath: string, value: unknown) => {
    await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeMiniMaxCodeSessionFixture = async ({
    sessionId = MINIMAX_CODE_SESSION_ID,
    sessionsDir,
    workspacePath,
}: {
    sessionId?: string;
    sessionsDir: string;
    workspacePath: string;
}) => {
    const encodedSessionId = Buffer.from(sessionId).toString('base64').replace(/=+$/u, '');
    const sessionDir = path.join(sessionsDir, '2026', '07', '22', `21-38-36-307-session_${encodedSessionId}`);
    await mkdir(sessionDir, { recursive: true });

    await writeJson(path.join(sessionDir, 'manifest.json'), {
        createdAtMs: 1_784_770_716_307,
        layout: 'v2-final-dated-session',
        paths: {
            display: path.join(sessionDir, 'display.jsonl'),
            ledger: path.join(sessionDir, 'ledger.jsonl'),
            reports: path.join(sessionDir, 'reports'),
            sessionDir,
            snapshot: path.join(sessionDir, 'snapshot.json'),
        },
        schemaVersion: 1,
        sessionId,
        source: 'local-runtime',
        updatedAtMs: 1_784_771_171_856,
    });

    await writeJson(path.join(sessionDir, 'snapshot.json'), {
        createdAtMs: 1_784_771_171_852,
        deleted: false,
        displayMessages: [
            {
                msg_content:
                    'Come up with a plan to decompose and refactor src/cleanup-briefs/rename-evidence/evidence-extraction.ts.',
                msg_id: 'user-1',
                msg_type: 1,
                role: 'user',
                timestamp: 1_784_770_716_404,
            },
            {
                finish_reason: 'toolUse',
                msg_content: "I'll investigate this thoroughly before sketching a plan.",
                msg_id: 'assistant-progress',
                msg_type: 2,
                role: 'assistant',
                thinking_content: "I need the complete picture. Let me also look at what's imported.",
                thinking_duration_ms: 1_229,
                timestamp: 1_784_770_724_176,
                tool_calls: [
                    {
                        tool_call_args: JSON.stringify({
                            command: 'grep -rn "evidence-extraction" /Users/rhaq/workspace/ushman/CHANGELOG.md',
                        }),
                        tool_call_id: 'call-success',
                        tool_call_result_data: JSON.stringify({
                            content: [{ text: 'CHANGELOG.md:42:evidence-extraction', type: 'text' }],
                            details: {},
                        }),
                        tool_call_status: 2,
                        tool_name: 'bash',
                    },
                ],
            },
            {
                finish_reason: 'toolUse',
                msg_content: '',
                msg_id: 'assistant-retry',
                msg_type: 2,
                role: 'assistant',
                thinking_content: 'That path was wrong, so I will retry from the workspace root.',
                timestamp: 1_784_770_725_176,
                tool_calls: [
                    {
                        tool_call_args: JSON.stringify({ command: 'grep -rn missing-file .' }),
                        tool_call_id: 'call-failed',
                        tool_call_result_data: JSON.stringify({
                            content: [{ text: 'Command exited with code 1', type: 'text' }],
                            details: {},
                        }),
                        tool_call_status: 3,
                        tool_name: 'bash',
                    },
                ],
            },
            {
                msg_content: JSON.stringify([{ content: 'Inspect module boundaries', status: 'completed' }]),
                msg_id: 'local_todo_1',
                msg_type: 3,
            },
            {
                finish_reason: 'stop',
                msg_content: 'The detailed decomposition plan is ready.',
                msg_id: 'assistant-final',
                msg_type: 1,
                role: 'assistant',
                timestamp: 1_784_771_171_421,
                tool_calls: [],
            },
        ],
        piHistory: [],
        piHistoryFacts: true,
        record: {
            agentName: 'main',
            appMode: 'coding',
            archived: false,
            createdAtMs: 1_784_770_716_307,
            effectiveModel: 'minimax/MiniMax-M3',
            effectiveModelVariant: 'thinking',
            isDefaultWorkspace: false,
            origin: 'user',
            parentSessionId: null,
            runtime: 'pi-agent',
            sessionDataVersion: 3,
            sessionId,
            sessionOrigin: 'local-runtime',
            sessionType: 'branch',
            status: 'finished',
            title: 'Refactor evidence extraction module',
            updatedAtMs: 1_784_771_171_843,
            workspaceDir: workspacePath,
        },
        schemaVersion: 1,
        sessionId,
        snapshotId: 'snapshot-1',
        watermark: {
            byteOffset: 1,
            lastEventId: 'event-1',
            lastSeq: 1,
            sessionId,
            updatedAtMs: 1_784_771_171_856,
        },
    });

    return {
        sessionDir,
        sessionId,
        snapshotPath: path.join(sessionDir, 'snapshot.json'),
        workspaceKey: `${MINIMAX_CODE_WORKSPACE_KEY_PREFIX}${encodeURIComponent(workspacePath)}`,
    };
};
