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
import { writeMiniMaxCodeRuntimeFixture, writeMiniMaxCodeSessionFixture } from './minimax-code-test-helpers';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'minimax-code-db-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
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
            const dump = db.serialize().toString();
            expect(dump).not.toContain(fixture.sessionId);
            expect(dump).toContain(keepSessionId);
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
