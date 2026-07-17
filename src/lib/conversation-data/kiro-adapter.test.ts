import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { kiroConversationAdapter } from './kiro-adapter';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const encodeWorkspace = (workspacePath: string) =>
    Buffer.from(workspacePath, 'utf8')
        .toString('base64')
        .replace(/=+$/u, (match) => '_'.repeat(match.length));

const writeKiroSession = async (sessionsDir: string, sessionId: string, workspacePath: string) => {
    const workspaceDir = path.join(sessionsDir, encodeWorkspace(workspacePath));
    await mkdir(workspaceDir, { recursive: true });
    await Bun.write(
        path.join(workspaceDir, 'sessions.json'),
        JSON.stringify([
            {
                dateCreated: '1700000000000',
                sessionId,
                title: 'Kiro adapter fixture',
                workspaceDirectory: workspacePath,
            },
        ]),
    );
    await Bun.write(
        path.join(workspaceDir, `${sessionId}.json`),
        JSON.stringify({
            active: false,
            autonomyMode: 'Autopilot',
            defaultModelTitle: 'Agent',
            history: [
                {
                    contextItems: [],
                    editorState: { type: 'doc' },
                    message: {
                        content: [
                            { text: 'Review this Kiro session.', type: 'text' },
                            { imageUrl: { url: 'data:image/png;base64,AAA' }, type: 'imageUrl' },
                        ],
                        id: 'user-message',
                        role: 'user',
                    },
                },
                {
                    contextItems: [],
                    editorState: { type: 'doc' },
                    executionId: 'execution-1',
                    message: { content: 'Kiro review complete.', id: 'assistant-message', role: 'assistant' },
                    promptLogs: [],
                },
            ],
            selectedModel: 'claude-sonnet-4.5',
            sessionId,
            sessionType: 'spec',
            title: 'Kiro adapter fixture',
            workspaceDirectory: workspacePath,
            workspacePath,
        }),
    );
};

describe('Kiro conversation adapter', () => {
    it('should preserve user attachments and classify the final assistant response', async () => {
        const sessionsDir = await mkdtemp(path.join(os.tmpdir(), 'kiro-adapter-'));
        tempDirs.push(sessionsDir);
        const sessionId = 'session-kiro';
        const workspacePath = path.join(sessionsDir, 'repo');
        await writeKiroSession(sessionsDir, sessionId, workspacePath);

        const conversation = await kiroConversationAdapter.getConversation({
            id: sessionId,
            locations: { kiroWorkspaceSessionsDir: sessionsDir },
            messageSelector: 'all',
            source: 'kiro',
        });

        expect(conversation).toMatchObject({
            deepLinks: { ui: `/kiro-sessions/${sessionId}` },
            id: sessionId,
            metadata: { model: 'claude-sonnet-4.5', sessionType: 'spec' },
            source: 'kiro',
            workspacePath,
        });
        expect(conversation?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    metadata: { imageUrl: 'data:image/png;base64,AAA' },
                    role: 'user',
                    text: 'Image attachment',
                }),
                expect.objectContaining({
                    phase: 'final_answer',
                    role: 'assistant',
                    text: 'Kiro review complete.',
                }),
            ]),
        );
    });
});
