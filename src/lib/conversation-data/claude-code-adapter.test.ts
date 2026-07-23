import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeCodeConversationAdapter } from './claude-code-adapter';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const writeClaudeSession = async (projectsDir: string, sessionId: string, cwd: string) => {
    const projectDir = path.join(projectsDir, 'project');
    await mkdir(projectDir, { recursive: true });
    const records = [
        {
            attachment: { content: '', type: 'image' },
            cwd,
            sessionId,
            timestamp: '2026-06-01T10:00:00.500Z',
            type: 'attachment',
            uuid: 'attachment-1',
        },
        {
            cwd,
            message: { content: 'Review this project.', role: 'user' },
            sessionId,
            timestamp: '2026-06-01T10:00:00.000Z',
            type: 'user',
            uuid: 'user-1',
        },
        {
            cwd,
            message: {
                content: [
                    { thinking: 'I should inspect the source.', type: 'thinking' },
                    { id: 'tool-1', input: { path: 'src/index.ts' }, name: 'Read', type: 'tool_use' },
                    { text: 'Checking the implementation.', type: 'text' },
                ],
                model: 'claude-sonnet-4-5',
                role: 'assistant',
            },
            parentUuid: 'user-1',
            sessionId,
            timestamp: '2026-06-01T10:00:01.000Z',
            type: 'assistant',
            uuid: 'assistant-1',
            version: '2.1.148',
        },
        {
            cwd,
            message: {
                content: [{ content: 'file contents', is_error: false, tool_use_id: 'tool-1', type: 'tool_result' }],
                role: 'user',
            },
            parentUuid: 'assistant-1',
            sessionId,
            timestamp: '2026-06-01T10:00:02.000Z',
            type: 'user',
            uuid: 'user-2',
        },
        {
            cwd,
            message: { content: 'The implementation is correct.', model: 'claude-sonnet-4-5', role: 'assistant' },
            parentUuid: 'user-2',
            sessionId,
            timestamp: '2026-06-01T10:00:03.000Z',
            type: 'assistant',
            uuid: 'assistant-2',
            version: '2.1.148',
        },
    ];
    await Bun.write(
        path.join(projectDir, `${sessionId}.jsonl`),
        `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    );
};

describe('Claude Code conversation adapter', () => {
    it('should normalize transcript phases, tools, metadata, and message order', async () => {
        const projectsDir = await mkdtemp(path.join(os.tmpdir(), 'claude-adapter-'));
        tempDirs.push(projectsDir);
        const sessionId = 'session-claude';
        const cwd = path.join(projectsDir, 'repo');
        await writeClaudeSession(projectsDir, sessionId, cwd);

        const conversation = await claudeCodeConversationAdapter.getConversation({
            id: sessionId,
            locations: { claudeCodeProjectsDir: projectsDir },
            messageSelector: 'all',
            source: 'claude-code',
        });
        const mergedConversation = await claudeCodeConversationAdapter.getConversation({
            id: sessionId,
            locations: { claudeCodeProjectsDir: projectsDir },
            merged: true,
            messageSelector: 'all',
            source: 'claude-code',
        });

        expect(conversation).toMatchObject({
            deepLinks: { ui: `/claude-code-sessions/${sessionId}` },
            id: sessionId,
            metadata: { model: 'claude-sonnet-4-5', version: '2.1.148' },
            source: 'claude-code',
            workspacePath: cwd,
        });
        expect(conversation?.messages.map((message) => message.order)).toEqual(
            conversation?.messages.map((_, index) => index),
        );
        expect(conversation?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'reasoning', text: 'I should inspect the source.' }),
                expect.objectContaining({
                    phase: 'tool_call',
                    role: 'tool',
                    toolEvidence: expect.objectContaining({ callId: 'tool-1', name: 'Read' }),
                }),
                expect.objectContaining({
                    phase: 'tool_output',
                    role: 'tool',
                    text: 'file contents',
                    toolEvidence: expect.objectContaining({
                        callId: 'tool-1',
                        outputText: 'file contents',
                        status: 'unknown',
                    }),
                }),
                expect.objectContaining({ metadata: { attachmentType: 'image' }, text: '[Attachment: image]' }),
                expect.objectContaining({
                    phase: 'final_answer',
                    role: 'assistant',
                    text: 'The implementation is correct.',
                }),
            ]),
        );
        expect(mergedConversation).toMatchObject({
            deepLinks: { ui: `/claude-code-sessions/${sessionId}?merged=true` },
            metadata: { mergedSessionIds: [sessionId] },
        });
    });

    it('should list path-scoped Claude conversations within an updated-time window', async () => {
        const projectsDir = await mkdtemp(path.join(os.tmpdir(), 'claude-adapter-list-'));
        tempDirs.push(projectsDir);
        const cwd = path.join(projectsDir, 'repo');
        await writeClaudeSession(projectsDir, 'session-in-window', cwd);

        const conversations = await claudeCodeConversationAdapter.listConversationsForPath({
            cwd,
            includeMessages: false,
            locations: { claudeCodeProjectsDir: projectsDir },
            updatedAfterMs: Date.parse('2026-06-01T10:00:02.000Z'),
            updatedBeforeMs: Date.parse('2026-06-01T10:00:04.000Z'),
        });
        const excluded = await claudeCodeConversationAdapter.listConversationsForPath({
            cwd,
            locations: { claudeCodeProjectsDir: projectsDir },
            updatedAfterMs: Date.parse('2026-06-01T10:00:04.000Z'),
        });

        expect(conversations.map(({ id }) => id)).toEqual(['session-in-window']);
        expect(conversations[0]?.matches[0]?.kind).toBe('exact');
        expect(conversations[0]?.messages).toEqual([]);
        expect(excluded).toEqual([]);
    });
});
