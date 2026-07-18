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
        num_chat_messages: 7,
        sandbox_profile: 'off',
    });
    await writeJsonl(path.join(sessionDir, 'chat_history.jsonl'), [
        { content: 'System prompt', type: 'system' },
        {
            content: [{ text: '<user_info>\nOS Version: darwin 25.5.0\n</user_info>', type: 'text' }],
            type: 'user',
        },
        {
            content: [
                {
                    text: '<user_query>\nPlease review the seed refresh implementation.\n</user_query>',
                    type: 'text',
                },
            ],
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
    it('should preserve structured assistant content arrays', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath: '/workspace/structured' });
        await writeJsonl(path.join(fixture.sessionDir, 'chat_history.jsonl'), [
            { content: [{ text: '<user_query>Question</user_query>', type: 'text' }], type: 'user' },
            {
                content: [
                    { text: 'First paragraph', type: 'text' },
                    { text: 'Second paragraph', type: 'text' },
                ],
                type: 'assistant',
            },
        ]);

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);

        expect(transcript?.entries.find((entry) => entry.role === 'assistant')?.parts[0]).toMatchObject({
            text: 'First paragraph\n\nSecond paragraph',
        });
    });

    it('should not duplicate an archived prefix when a compaction checkpoint is missing', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath: '/workspace/no-checkpoint' });
        const archivedPrefix = [
            { content: [{ text: '<user_query>First</user_query>', type: 'text' }], type: 'user' },
            { content: 'First answer', type: 'assistant' },
        ];
        await writeJsonl(path.join(fixture.sessionDir, 'chat_history.jsonl'), [
            ...archivedPrefix,
            { content: [{ text: '<user_query>Second</user_query>', type: 'text' }], type: 'user' },
            { content: 'Second answer', type: 'assistant' },
        ]);
        await mkdir(path.join(fixture.sessionDir, 'compaction_requests'), { recursive: true });
        await writeJson(path.join(fixture.sessionDir, 'compaction_requests', 'request.json'), {
            chat_history: archivedPrefix,
            created_at: '2026-07-04T16:52:00.000Z',
        });

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);
        const texts = transcript?.entries.flatMap((entry) => entry.parts.flatMap((part) => part.text ?? [])) ?? [];

        expect(texts.filter((text) => text === 'First answer')).toHaveLength(1);
        expect(texts.filter((text) => text === 'Second answer')).toHaveLength(1);
    });

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
                messageCount: 2,
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
                messageCount: 2,
                modelLabel: 'Composer 2.5',
                sessionId: fixture.sessionId,
                title: 'Review #109 #209',
            }),
        ]);

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);
        expect(transcript?.entries.map((entry) => entry.type)).toEqual([
            'system',
            'user',
            'user',
            'reasoning',
            'assistant',
            'tool_result',
            'assistant',
        ]);
        expect(transcript?.entries.map((entry) => entry.role)).toEqual([
            'system',
            'system',
            'user',
            'assistant',
            'assistant',
            'tool',
            'assistant',
        ]);
        expect(transcript?.entries[2]?.parts[0]?.text).toBe('Please review the seed refresh implementation.');
        expect(transcript?.renderablePartCount).toBe(7);
    });

    it('should skip null JSONL records without losing valid Grok messages', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath: path.join(grokHome, 'project') });
        const historyPath = path.join(fixture.sessionDir, 'chat_history.jsonl');
        await Bun.write(historyPath, `null\n${await Bun.file(historyPath).text()}`);

        const originalWarn = console.warn;
        console.warn = () => undefined;
        try {
            const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);

            expect(transcript?.entries).toHaveLength(7);
            expect(transcript?.session.messageCount).toBe(2);
        } finally {
            console.warn = originalWarn;
        }
    });

    it('should omit Grok sessions that contain only system bootstrap messages', async () => {
        const grokHome = await makeTempRoot();
        const workspacePath = path.join(grokHome, 'project');
        const fixture = await writeGrokSessionFixture({ grokHome, sessionId: 'system-only', workspacePath });
        await writeJsonl(path.join(fixture.sessionDir, 'chat_history.jsonl'), [
            { content: 'You are Grok.', type: 'system' },
            {
                content: [{ text: '<system-reminder>Available skills</system-reminder>', type: 'text' }],
                type: 'user',
            },
        ]);

        expect(await listGrokWorkspaceGroups(fixture.sessionsDir)).toEqual([]);
        expect(await listGrokSessionsForGroup(fixture.workspaceKey, fixture.sessionsDir)).toEqual([]);

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);
        expect(transcript?.entries.map((entry) => entry.role)).toEqual(['system', 'system']);
        expect(transcript?.session).toMatchObject({
            assistantMessageCount: 0,
            userMessageCount: 0,
        });
    });

    it('should rehydrate Grok messages hidden by context compaction', async () => {
        const grokHome = await makeTempRoot();
        const workspacePath = path.join(grokHome, 'project');
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath });
        const preCompactionHistory = [
            { content: 'System prompt', type: 'system' },
            {
                content: [{ text: '<user_info>\nOS Version: darwin 25.5.0\n</user_info>', type: 'text' }],
                type: 'user',
            },
            {
                content: [{ text: '<user_query>\nFirst user prompt.\n</user_query>', type: 'text' }],
                type: 'user',
            },
            {
                content: 'First answer before compaction.',
                model_id: 'grok-composer-2.5-fast',
                type: 'assistant',
            },
        ];
        const compactedHistory = [
            preCompactionHistory[0],
            preCompactionHistory[1],
            {
                content: [{ text: 'Your conversation was summarized due to context constraints.', type: 'text' }],
                type: 'user',
            },
        ];
        await mkdir(path.join(fixture.sessionDir, 'compaction_requests'), { recursive: true });
        await mkdir(path.join(fixture.sessionDir, 'compaction_checkpoints'), { recursive: true });
        await writeJson(path.join(fixture.sessionDir, 'compaction_requests', 'request.json'), {
            chat_history: preCompactionHistory,
            created_at: '2026-07-04T16:52:00.000Z',
            schema_version: 1,
        });
        await writeJson(path.join(fixture.sessionDir, 'compaction_checkpoints', 'checkpoint.json'), {
            compacted_history: compactedHistory,
            created_at: '2026-07-04T16:52:10.000Z',
            prompt_index_at_compaction: 1,
            schema_version: 1,
        });
        await writeJsonl(path.join(fixture.sessionDir, 'chat_history.jsonl'), [
            ...compactedHistory,
            {
                content: [{ text: '<user_query>\nSecond user prompt after compaction.\n</user_query>', type: 'text' }],
                type: 'user',
            },
            {
                content: 'Second answer after compaction.',
                model_id: 'grok-composer-2.5-fast',
                type: 'assistant',
            },
        ]);

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);

        expect(transcript?.entries.map((entry) => entry.parts[0]?.text).filter(Boolean)).toContain(
            'First user prompt.',
        );
        expect(transcript?.entries.map((entry) => entry.parts[0]?.text).filter(Boolean)).not.toContain(
            'Your conversation was summarized due to context constraints.',
        );
        expect(transcript?.entries.map((entry) => entry.parts[0]?.text).filter(Boolean)).toContain(
            'Second user prompt after compaction.',
        );
        expect(transcript?.entries.map((entry) => entry.parts[0]?.text).filter(Boolean)).toContain(
            'Second answer after compaction.',
        );
        expect(transcript?.session.userMessageCount).toBe(2);
    });

    it('should use the checkpoint prompt index when compacted history is not the live prefix', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath: path.join(grokHome, 'project') });
        const archivedHistory = [
            { content: 'System prompt', type: 'system' },
            { content: [{ text: '<user_query>First prompt</user_query>', type: 'text' }], type: 'user' },
            { content: 'First answer', type: 'assistant' },
        ];
        await mkdir(path.join(fixture.sessionDir, 'compaction_requests'), { recursive: true });
        await mkdir(path.join(fixture.sessionDir, 'compaction_checkpoints'), { recursive: true });
        await writeJson(path.join(fixture.sessionDir, 'compaction_requests', 'request.json'), {
            chat_history: archivedHistory,
            created_at: '2026-07-04T16:52:00.000Z',
        });
        await writeJson(path.join(fixture.sessionDir, 'compaction_checkpoints', 'checkpoint.json'), {
            compacted_history: [
                archivedHistory[0],
                { content: 'Summary that is not present in the live file', type: 'user' },
                { content: 'Compaction acknowledgement', type: 'assistant' },
            ],
            created_at: '2026-07-04T16:52:10.000Z',
            prompt_index_at_compaction: 1,
        });
        await writeJsonl(path.join(fixture.sessionDir, 'chat_history.jsonl'), [
            archivedHistory[0],
            { content: [{ text: '<user_query>Second prompt</user_query>', type: 'text' }], type: 'user' },
            { content: 'Second answer', type: 'assistant' },
        ]);

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);
        const text = transcript?.entries.flatMap((entry) => entry.parts.map((part) => part.text)).filter(Boolean);

        expect(text).toContain('First prompt');
        expect(text).toContain('First answer');
        expect(text).toContain('Second prompt');
        expect(text).toContain('Second answer');
    });

    it('should rehydrate messages across multiple Grok compactions', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath: path.join(grokHome, 'project') });
        const firstArchive = [
            { content: 'System prompt', type: 'system' },
            { content: [{ text: '<user_query>First prompt</user_query>', type: 'text' }], type: 'user' },
            { content: 'First answer', type: 'assistant' },
        ];
        const firstCheckpoint = [firstArchive[0], { content: 'Summary of the first turn', type: 'user' }];
        const secondArchive = [
            ...firstCheckpoint,
            { content: [{ text: '<user_query>Second prompt</user_query>', type: 'text' }], type: 'user' },
            { content: 'Second answer', type: 'assistant' },
        ];
        const secondCheckpoint = [firstArchive[0], { content: 'Summary of the first two turns', type: 'user' }];
        await mkdir(path.join(fixture.sessionDir, 'compaction_requests'), { recursive: true });
        await mkdir(path.join(fixture.sessionDir, 'compaction_checkpoints'), { recursive: true });
        await writeJson(path.join(fixture.sessionDir, 'compaction_requests', 'request-1.json'), {
            chat_history: firstArchive,
            created_at: '2026-07-04T16:52:00.000Z',
        });
        await writeJson(path.join(fixture.sessionDir, 'compaction_checkpoints', 'checkpoint-1.json'), {
            compacted_history: firstCheckpoint,
            created_at: '2026-07-04T16:52:10.000Z',
            prompt_index_at_compaction: 1,
        });
        await writeJson(path.join(fixture.sessionDir, 'compaction_requests', 'request-2.json'), {
            chat_history: secondArchive,
            created_at: '2026-07-04T16:53:00.000Z',
        });
        await writeJson(path.join(fixture.sessionDir, 'compaction_checkpoints', 'checkpoint-2.json'), {
            compacted_history: secondCheckpoint,
            created_at: '2026-07-04T16:53:10.000Z',
            prompt_index_at_compaction: 1,
        });
        await writeJsonl(path.join(fixture.sessionDir, 'chat_history.jsonl'), [
            ...secondCheckpoint,
            { content: [{ text: '<user_query>Third prompt</user_query>', type: 'text' }], type: 'user' },
            { content: 'Third answer', type: 'assistant' },
        ]);

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId);
        const text = transcript?.entries.flatMap((entry) => entry.parts.map((part) => part.text)).filter(Boolean);

        expect(text).toContain('First prompt');
        expect(text).toContain('First answer');
        expect(text).toContain('Second prompt');
        expect(text).toContain('Second answer');
        expect(text).toContain('Third prompt');
        expect(text).toContain('Third answer');
        expect(text).not.toContain('Summary of the first turn');
        expect(text).not.toContain('Summary of the first two turns');
    });

    it('should omit raw Grok payloads when requested for large UI responses', async () => {
        const grokHome = await makeTempRoot();
        const workspacePath = path.join(grokHome, 'project');
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath });

        const transcript = await readGrokSessionTranscript(fixture.sessionsDir, fixture.sessionId, {
            includeRawPayloads: false,
        });

        expect(transcript?.rawPayloadsOmitted).toBe(true);
        expect(transcript?.rawEvents).toEqual([]);
        expect(transcript?.entries[0]?.raw).toEqual({});
        expect(transcript?.entries[0]?.parts[0]?.raw).toEqual({});
        expect(transcript?.entries[2]?.parts[0]?.text).toBe('Please review the seed refresh implementation.');
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

    it('should reject unsafe ids in the direct Grok delete primitive', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath: path.join(grokHome, 'project') });

        await expect(deleteGrokSession(fixture.sessionsDir, '../session-1')).resolves.toEqual({
            deletedFiles: [],
            deletedSessionIds: [],
        });
        expect(await Bun.file(path.join(fixture.sessionDir, 'chat_history.jsonl')).exists()).toBe(true);
    });

    it('should delete a basename-matched session without parsing unrelated corrupt transcripts', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath: path.join(grokHome, 'project') });
        const corruptDir = path.join(fixture.sessionsDir, fixture.directoryName, 'corrupt-session');
        await mkdir(corruptDir, { recursive: true });
        await Bun.write(path.join(corruptDir, 'chat_history.jsonl'), '{not-json\n');

        const result = await deleteGrokSession(fixture.sessionsDir, fixture.sessionId);

        expect(result.deletedSessionIds).toEqual([fixture.sessionId]);
        expect(await Bun.file(path.join(corruptDir, 'chat_history.jsonl')).exists()).toBe(true);
    });

    it('should warn when active session state is malformed', async () => {
        const grokHome = await makeTempRoot();
        const fixture = await writeGrokSessionFixture({ grokHome, workspacePath: path.join(grokHome, 'project') });
        await Bun.write(path.join(grokHome, 'active_sessions.json'), '{not-json');
        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args) => warnings.push(args);

        try {
            await deleteGrokSession(fixture.sessionsDir, fixture.sessionId);
        } finally {
            console.warn = originalWarn;
        }

        expect(warnings).toEqual([expect.arrayContaining(['[spiracha:grok-db] malformed_active_sessions'])]);
    });

    it('should delete Grok subagent metadata and parent resource references for a session', async () => {
        const grokHome = await makeTempRoot();
        const workspacePath = path.join(grokHome, 'project');
        const parent = await writeGrokSessionFixture({
            grokHome,
            sessionId: 'parent-session',
            workspacePath,
        });
        const child = await writeGrokSessionFixture({
            grokHome,
            sessionId: 'child-session',
            workspacePath,
        });
        const subagentDir = path.join(parent.sessionDir, 'subagents', child.sessionId);
        await mkdir(subagentDir, { recursive: true });
        await writeJson(path.join(subagentDir, 'meta.json'), {
            child_session_id: child.sessionId,
            parent_session_id: parent.sessionId,
            subagent_id: child.sessionId,
        });
        await writeJson(path.join(parent.sessionDir, 'resources_state.json'), {
            state: {
                'grok_build.ReportedTaskCompletions': {
                    reported: [child.sessionId, 'kept-session'],
                },
                unrelated: {
                    reported: [child.sessionId],
                    sessionIds: [child.sessionId],
                },
            },
        });
        const collidingSubagentDir = path.join(parent.sessionDir, 'other', 'subagents', child.sessionId);
        await mkdir(collidingSubagentDir, { recursive: true });
        await writeJson(path.join(collidingSubagentDir, 'meta.json'), {
            child_session_id: 'different-session',
            parent_session_id: parent.sessionId,
            subagent_id: child.sessionId,
        });

        const result = await deleteGrokSession(child.sessionsDir, child.sessionId);

        expect(result.deletedSessionIds).toEqual([child.sessionId]);
        expect(result.deletedFiles).toContain(path.join(child.sessionDir, 'chat_history.jsonl'));
        expect(result.deletedFiles).toContain(path.join(subagentDir, 'meta.json'));
        await expect(readGrokSessionTranscript(child.sessionsDir, child.sessionId)).resolves.toBeNull();
        await expect(Bun.file(path.join(parent.sessionDir, 'resources_state.json')).json()).resolves.toEqual({
            state: {
                'grok_build.ReportedTaskCompletions': {
                    reported: ['kept-session'],
                },
                unrelated: {
                    reported: [child.sessionId],
                    sessionIds: [child.sessionId],
                },
            },
        });
        expect(await Bun.file(path.join(collidingSubagentDir, 'meta.json')).exists()).toBe(true);
    });
});
