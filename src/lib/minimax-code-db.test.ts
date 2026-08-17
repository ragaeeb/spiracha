import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteMiniMaxCodeSession,
    listMiniMaxCodeSessionsForGroup,
    listMiniMaxCodeWorkspaceGroups,
    readMiniMaxCodeSessionTranscript,
} from './minimax-code-db';
import { resolveMiniMaxCodeRuntimeDbPath } from './minimax-code-exporter-types';
import { writeMiniMaxCodeRuntimeFixture, writeMiniMaxCodeSessionFixture } from './minimax-code-test-helpers';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'minimax-code-db-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

const writeManifestMessagesSession = async (sessionsDir: string, sessionId: string) => {
    const encodedSessionId = Buffer.from(sessionId).toString('base64').replace(/=+$/u, '');
    const sessionDir = path.join(sessionsDir, '2026', '08', '17', `12-00-00-000-session_${encodedSessionId}`);
    await mkdir(sessionDir, { recursive: true });
    await Bun.write(
        path.join(sessionDir, 'manifest.json'),
        `${JSON.stringify({
            createdAtMs: 1_786_000_000_000,
            layout: 'v2-final-dated-session',
            paths: {
                ledger: 'ledger.jsonl',
                messages: 'messages.jsonl',
                reports: 'reports',
                sessionDir: path.basename(sessionDir),
                snapshot: 'snapshot.json',
            },
            schemaVersion: 1,
            sessionId,
            source: 'local-runtime',
            updatedAtMs: 1_786_000_000_100,
        })}\n`,
    );
    const messages = [
        {
            message: {
                content: [{ text: 'Please review this workspace.', type: 'text' }],
                role: 'user',
                timestamp: 1_786_000_000_010,
            },
            message_id: 'message-user',
            turn_id: 'turn-1',
        },
        {
            message: {
                content: [
                    { thinking: 'I will inspect the workspace first.', type: 'thinking' },
                    { arguments: { command: 'pwd' }, id: 'call-1', name: 'bash', type: 'toolCall' },
                ],
                model: 'MiniMax-M3',
                role: 'assistant',
                stopReason: 'toolUse',
                timestamp: 1_786_000_000_020,
            },
            message_id: 'message-assistant-tool',
            turn_id: 'turn-1',
        },
        {
            message: {
                content: [{ text: '/workspace/spiracha', type: 'text' }],
                details: {},
                isError: false,
                role: 'toolResult',
                timestamp: 1_786_000_000_030,
                toolCallId: 'call-1',
                toolName: 'bash',
            },
            message_id: 'message-tool-result',
            turn_id: 'turn-1',
        },
        {
            message: {
                content: [{ text: 'The workspace is ready for review.', type: 'text' }],
                model: 'MiniMax-M3',
                role: 'assistant',
                stopReason: 'stop',
                timestamp: 1_786_000_000_040,
            },
            message_id: 'message-assistant-final',
            turn_id: 'turn-1',
        },
    ];
    await Bun.write(
        path.join(sessionDir, 'messages.jsonl'),
        `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`,
    );
    return { sessionDir, sessionId };
};

const writeRuntimeSessionMetadata = async (
    sessionsDir: string,
    sessionId: string,
    workspacePath?: string,
): Promise<void> => {
    const runtimeDbPath = resolveMiniMaxCodeRuntimeDbPath(sessionsDir);
    await mkdir(path.dirname(runtimeDbPath), { recursive: true });
    const db = new Database(runtimeDbPath, { create: true, strict: true });
    try {
        db.run(
            'CREATE TABLE local_runtime_sessions (session_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)',
        );
        db.query('INSERT INTO local_runtime_sessions (session_id, record_json, updated_at_ms) VALUES (?, ?, ?)').run(
            sessionId,
            JSON.stringify({
                agentName: 'main',
                archived: false,
                createdAtMs: 1_786_000_000_000,
                effectiveModel: 'minimax/MiniMax-M3',
                effectiveModelVariant: 'thinking',
                runtime: 'pi-agent',
                sessionId,
                sessionType: 'root',
                status: 'idle',
                title: 'Manifest messages review',
                updatedAtMs: 1_786_000_000_100,
                ...(workspacePath ? { workspaceDir: workspacePath } : {}),
            }),
            1_786_000_000_100,
        );
    } finally {
        db.close();
    }
};

describe('MiniMax Code db helpers', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should list workspaces and sessions from finalized v2 snapshots', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const workspacePath = path.join(tempRoot, 'project');
        const fixture = await writeMiniMaxCodeSessionFixture({ sessionsDir, workspacePath });

        const workspaces = await listMiniMaxCodeWorkspaceGroups(sessionsDir);
        expect(workspaces).toEqual([
            expect.objectContaining({
                assistantMessageCount: 3,
                key: fixture.workspaceKey,
                label: 'project',
                messageCount: 4,
                reasoningCount: 2,
                sessionCount: 1,
                toolCallCount: 2,
                toolResultCount: 2,
                userMessageCount: 1,
                worktree: workspacePath,
            }),
        ]);

        const sessions = await listMiniMaxCodeSessionsForGroup(fixture.workspaceKey, sessionsDir);
        expect(sessions).toEqual([
            expect.objectContaining({
                agentName: 'main',
                currentModelId: 'minimax/MiniMax-M3',
                currentModelVariant: 'thinking',
                messageCount: 4,
                sessionId: fixture.sessionId,
                status: 'finished',
                title: 'Refactor evidence extraction module',
            }),
        ]);
    });

    it('should parse chat, reasoning, tool evidence, and final answers while ignoring todo state', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const fixture = await writeMiniMaxCodeSessionFixture({
            sessionsDir,
            workspacePath: path.join(tempRoot, 'project'),
        });

        const transcript = await readMiniMaxCodeSessionTranscript(sessionsDir, fixture.sessionId);

        expect(transcript?.messages).toHaveLength(4);
        expect(transcript?.messages.map((message) => message.messageId)).toEqual([
            'user-1',
            'assistant-progress',
            'assistant-retry',
            'assistant-final',
        ]);
        expect(transcript?.messages[1]).toMatchObject({
            content: "I'll investigate this thoroughly before sketching a plan.",
            finishReason: 'toolUse',
            reasoning: "I need the complete picture. Let me also look at what's imported.",
        });
        expect(transcript?.messages[1]?.toolCalls[0]).toMatchObject({
            callId: 'call-success',
            command: 'grep -rn "evidence-extraction" /Users/rhaq/workspace/ushman/CHANGELOG.md',
            outputText: 'CHANGELOG.md:42:evidence-extraction',
            status: 'succeeded',
            toolName: 'bash',
        });
        expect(transcript?.messages[2]?.toolCalls[0]).toMatchObject({
            callId: 'call-failed',
            status: 'failed',
        });
    });

    it('should skip malformed snapshots and sessions without chat messages', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const malformedDir = path.join(sessionsDir, '2026', '07', '21', 'malformed');
        const emptyDir = path.join(sessionsDir, '2026', '07', '20', 'empty');
        await Promise.all([mkdir(malformedDir, { recursive: true }), mkdir(emptyDir, { recursive: true })]);
        await Bun.write(path.join(malformedDir, 'snapshot.json'), '{not json');
        await Bun.write(
            path.join(emptyDir, 'snapshot.json'),
            JSON.stringify({
                displayMessages: [{ msg_content: 'todo', msg_id: 'todo-1', msg_type: 3 }],
                record: {
                    createdAtMs: 1,
                    sessionId: 'empty',
                    title: 'empty',
                    updatedAtMs: 2,
                    workspaceDir: '/tmp/empty',
                },
                sessionId: 'empty',
            }),
        );

        await expect(listMiniMaxCodeWorkspaceGroups(sessionsDir)).resolves.toEqual([]);
    });

    it('should list and read sessions stored as manifest.json plus messages.jsonl', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const workspacePath = path.join(tempRoot, 'project');
        const fixture = await writeManifestMessagesSession(sessionsDir, 'mvs_112233aabbcc');
        await writeRuntimeSessionMetadata(sessionsDir, fixture.sessionId, workspacePath);

        const workspaces = await listMiniMaxCodeWorkspaceGroups(sessionsDir);
        expect(workspaces).toEqual([
            expect.objectContaining({
                key: `workspace:${encodeURIComponent(workspacePath)}`,
                messageCount: 3,
                sessionCount: 1,
                worktree: workspacePath,
            }),
        ]);

        const transcript = await readMiniMaxCodeSessionTranscript(sessionsDir, fixture.sessionId);
        expect(transcript?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant']);
        expect(transcript?.messages[1]?.reasoning).toBe('I will inspect the workspace first.');
        expect(transcript?.messages[1]?.toolCalls[0]).toMatchObject({
            callId: 'call-1',
            command: 'pwd',
            outputText: '/workspace/spiracha',
            status: 'succeeded',
            toolName: 'bash',
        });
        expect(transcript?.session).toMatchObject({
            sessionId: fixture.sessionId,
            title: 'Manifest messages review',
            worktree: workspacePath,
        });
    });

    it('should read the effective model from runtime extra_data_json', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const workspacePath = path.join(tempRoot, 'project');
        const fixture = await writeManifestMessagesSession(sessionsDir, 'mvs_extradata123');
        const runtimeDbPath = resolveMiniMaxCodeRuntimeDbPath(sessionsDir);
        await mkdir(path.dirname(runtimeDbPath), { recursive: true });

        const db = new Database(runtimeDbPath, { create: true, strict: true });
        try {
            db.run(
                'CREATE TABLE local_runtime_sessions (session_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, extra_data_json TEXT NOT NULL)',
            );
            db.query(
                'INSERT INTO local_runtime_sessions (session_id, record_json, updated_at_ms, extra_data_json) VALUES (?, ?, ?, ?)',
            ).run(
                fixture.sessionId,
                JSON.stringify({
                    sessionId: fixture.sessionId,
                    status: 'idle',
                    title: 'Runtime model metadata',
                    updatedAtMs: 1_786_000_000_100,
                    workspaceDir: workspacePath,
                }),
                1_786_000_000_100,
                JSON.stringify({
                    effectiveModel: 'minimax/MiniMax-M3',
                    effectiveModelVariant: 'thinking',
                }),
            );
        } finally {
            db.close();
        }

        const transcript = await readMiniMaxCodeSessionTranscript(sessionsDir, fixture.sessionId);

        expect(transcript?.session).toMatchObject({
            currentModelId: 'minimax/MiniMax-M3',
            currentModelVariant: 'thinking',
            worktree: workspacePath,
        });
    });

    it('should reject manifest messages sessions without runtime workspace metadata', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        await writeManifestMessagesSession(sessionsDir, 'mvs_aabbcc112233');

        await expect(listMiniMaxCodeWorkspaceGroups(sessionsDir)).resolves.toEqual([]);
        await expect(readMiniMaxCodeSessionTranscript(sessionsDir, 'mvs_aabbcc112233')).resolves.toBeNull();
    });

    it('should delete a finalized session directory and every authoritative runtime row', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const runtimeDbPath = path.join(tempRoot, 'v2', 'sqlite', 'runtime-state.sqlite');
        const workspacePath = path.join(tempRoot, 'project');
        const generatedFile = path.join(workspacePath, 'generated-plan.md');
        const fixture = await writeMiniMaxCodeSessionFixture({ sessionsDir, workspacePath });
        await Bun.write(generatedFile, 'Keep generated workspace output');
        const { keepSessionId } = await writeMiniMaxCodeRuntimeFixture({
            assetPath: generatedFile,
            runtimeDbPath,
            sessionId: fixture.sessionId,
        });

        const result = await deleteMiniMaxCodeSession(sessionsDir, runtimeDbPath, fixture.sessionId);

        expect(result.deletedSessionIds).toEqual([fixture.sessionId]);
        expect(result.deletedFiles).toContain(fixture.snapshotPath);
        expect(await Bun.file(fixture.snapshotPath).exists()).toBe(false);
        expect(await Bun.file(generatedFile).text()).toBe('Keep generated workspace output');
        const db = new Database(runtimeDbPath, { readonly: true, strict: true });
        try {
            const countRows = (query: string, ...values: string[]) => {
                const row = db.query(query).get(...values) as { count: number };
                return row.count;
            };

            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_sessions WHERE session_id = ?',
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_message_rows WHERE session_id = ?',
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_pi_history_rows WHERE session_id = ?',
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_token_usage WHERE session_id = ?',
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_turn_diffs WHERE session_id = ?',
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_session_assets WHERE session_id = ?',
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_communication_messages WHERE from_session = ? OR to_session = ?',
                    fixture.sessionId,
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_background_tasks WHERE owner_session_id = ?',
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_background_task_events WHERE owner_session_id = ?',
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows(
                    'SELECT COUNT(*) AS count FROM local_runtime_legacy_migrations WHERE local_session_id = ? OR legacy_daemon_session_id = ? OR legacy_framework_session_id = ?',
                    fixture.sessionId,
                    fixture.sessionId,
                    fixture.sessionId,
                ),
            ).toBe(0);
            expect(
                countRows('SELECT COUNT(*) AS count FROM local_runtime_sessions WHERE session_id = ?', keepSessionId),
            ).toBe(1);
        } finally {
            db.close();
        }
    });

    it('should restore session files and preserve runtime rows when the session is locked', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const runtimeDbPath = path.join(tempRoot, 'v2', 'sqlite', 'runtime-state.sqlite');
        const fixture = await writeMiniMaxCodeSessionFixture({
            sessionsDir,
            workspacePath: path.join(tempRoot, 'project'),
        });
        await writeMiniMaxCodeRuntimeFixture({
            locked: true,
            runtimeDbPath,
            sessionId: fixture.sessionId,
        });

        await expect(deleteMiniMaxCodeSession(sessionsDir, runtimeDbPath, fixture.sessionId)).rejects.toThrow(
            'currently locked',
        );
        expect(await Bun.file(fixture.snapshotPath).exists()).toBe(true);
        const db = new Database(runtimeDbPath, { readonly: true, strict: true });
        try {
            expect(
                db.query('SELECT session_id FROM local_runtime_sessions WHERE session_id = ?').get(fixture.sessionId),
            ).not.toBeNull();
        } finally {
            db.close();
        }
    });

    it('should reject unsafe session ids without deleting files', async () => {
        const tempRoot = await makeTempRoot();
        const sessionsDir = path.join(tempRoot, 'v2', 'sessions');
        const fixture = await writeMiniMaxCodeSessionFixture({
            sessionsDir,
            workspacePath: path.join(tempRoot, 'project'),
        });

        await expect(
            deleteMiniMaxCodeSession(sessionsDir, path.join(tempRoot, 'runtime-state.sqlite'), '../session'),
        ).resolves.toEqual({
            deletedFiles: [],
            deletedSessionIds: [],
        });
        expect(await Bun.file(fixture.snapshotPath).exists()).toBe(true);
    });
});
