import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteGrokSession,
    listGrokSessionsForGroup,
    listGrokWorkspaceGroups,
    readGrokSessionTranscript,
} from './grok-db';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'grok-db-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

const writeJson = async (filePath: string, value: unknown) => {
    await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeJsonl = async (filePath: string, values: unknown[]) => {
    await Bun.write(filePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
};

const writeGrokSessionFixture = async ({
    grokHome,
    sessionId = 'session-1',
    workspacePath,
}: {
    readonly grokHome: string;
    readonly sessionId?: string;
    readonly workspacePath: string;
}) => {
    const sessionsDir = path.join(grokHome, 'sessions');
    const directoryName = encodeURIComponent(workspacePath);
    const sessionDir = path.join(sessionsDir, directoryName, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeJson(path.join(grokHome, 'models_cache.json'), {
        models: {
            'grok-composer-2.5-fast': {
                info: {
                    name: 'Composer 2.5',
                },
            },
        },
    });
    await writeJson(path.join(sessionDir, 'summary.json'), {
        agent_name: 'cursor',
        created_at: '2026-07-04T16:51:16.000Z',
        current_model_id: 'grok-composer-2.5-fast',
        generated_title: 'Review #109 #209',
        head_branch: 'main',
        head_commit: 'abc123',
        info: {
            cwd: workspacePath,
            id: sessionId,
        },
        last_active_at: '2026-07-04T16:53:22.000Z',
        num_chat_messages: 6,
        sandbox_profile: 'off',
    });
    await writeJsonl(path.join(sessionDir, 'chat_history.jsonl'), [
        { content: 'System prompt', type: 'system' },
        {
            content: [{ text: 'Please review the seed refresh implementation.', type: 'text' }],
            type: 'user',
        },
        {
            summary: [{ summary_text: 'Inspecting the refresh path.' }],
            type: 'reasoning',
        },
        {
            content: '',
            model_id: 'grok-composer-2.5-fast',
            tool_calls: [
                {
                    arguments: '{"pattern":"Failed refresh leaves a mutated candidate"}',
                    id: 'call-1',
                    name: 'Grep',
                },
            ],
            type: 'assistant',
        },
        {
            content: 'found 1 match',
            tool_call_id: 'call-1',
            type: 'tool_result',
        },
        {
            content: 'Failed refresh leaves a mutated candidate tree with stale artifacts.',
            model_fingerprint: 'fp_123',
            model_id: 'grok-composer-2.5-fast',
            type: 'assistant',
        },
    ]);
    await writeJson(path.join(grokHome, 'active_sessions.json'), [
        {
            cwd: workspacePath,
            session_id: sessionId,
        },
    ]);

    return {
        directoryName,
        sessionDir,
        sessionId,
        sessionsDir,
        workspaceKey: `workspace:${directoryName}`,
    };
};

describe('grok db helpers', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should list Grok workspaces, sessions, and transcript parts from local session files', async () => {
        const grokHome = await makeTempRoot();
        const workspacePath = path.join(grokHome, 'project');
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath });

        const workspaces = await listGrokWorkspaceGroups(fixture.sessionsDir);
        expect(workspaces).toEqual([
            expect.objectContaining({
                assistantMessageCount: 1,
                key: fixture.workspaceKey,
                label: 'project',
                sessionCount: 1,
                toolCallCount: 1,
                toolResultCount: 1,
                userMessageCount: 1,
                worktree: workspacePath,
            }),
        ]);

        const sessions = await listGrokSessionsForGroup(fixture.workspaceKey, fixture.sessionsDir);
        expect(sessions).toEqual([
            expect.objectContaining({
                currentModelId: 'grok-composer-2.5-fast',
                modelLabel: 'Composer 2.5',
                sessionId: fixture.sessionId,
                title: 'Review #109 #209',
            }),
        ]);

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);
        expect(transcript?.entries.map((entry) => entry.type)).toEqual([
            'system',
            'user',
            'reasoning',
            'assistant',
            'tool_result',
            'assistant',
        ]);
        expect(transcript?.renderablePartCount).toBe(6);
    });

    it('should delete a Grok session directory and active session entry', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({
            grokHome,
            workspacePath: path.join(grokHome, 'project'),
        });

        const result = await deleteGrokSession(fixture.sessionsDir, fixture.sessionId);

        expect(result.deletedSessionIds).toEqual([fixture.sessionId]);
        expect(result.deletedFiles.map((filePath) => path.basename(filePath)).sort()).toEqual([
            'chat_history.jsonl',
            'summary.json',
        ]);
        await expect(readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId)).resolves.toBeNull();
        await expect(Bun.file(path.join(grokHome, 'active_sessions.json')).json()).resolves.toEqual([]);
    });
});
