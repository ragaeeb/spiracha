import { afterEach, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    findKiroWorkspaceGroups,
    getDefaultKiroDataDir,
    listKiroSessionsForGroup,
    listKiroWorkspaceGroups,
    readKiroSessionTranscript,
} from './kiro-db';

const tempRoots: string[] = [];
const homeDir = os.homedir();
const corpusCwd = path.join(homeDir, 'workspace', 'ushman-corpus');
const otherCwd = path.join(homeDir, 'workspace', 'other');

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'kiro-db-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

const encodeKiroWorkspaceDirectoryName = (workspacePath: string) =>
    Buffer.from(workspacePath, 'utf8')
        .toString('base64')
        .replace(/=+$/u, (match) => '_'.repeat(match.length));

const getKiroWorkspaceHash = (workspacePath: string) =>
    createHash('sha256').update(workspacePath).digest('hex').slice(0, 32);

const writeSession = async ({
    createdAtMs,
    sessionsDir,
    sessionId,
    title,
    updatedAtMs,
    workspacePath,
}: {
    createdAtMs: number;
    sessionsDir: string;
    sessionId: string;
    title: string;
    updatedAtMs: number;
    workspacePath: string;
}) => {
    const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));
    await mkdir(workspaceDir, { recursive: true });
    const sessionsPath = path.join(workspaceDir, 'sessions.json');
    const existing = await Bun.file(sessionsPath)
        .json()
        .catch(() => []);
    await Bun.write(
        sessionsPath,
        JSON.stringify(
            [
                ...existing,
                {
                    dateCreated: String(createdAtMs),
                    sessionId,
                    title,
                    workspaceDirectory: workspacePath,
                },
            ],
            null,
            2,
        ),
    );

    const filePath = path.join(workspaceDir, `${sessionId}.json`);
    await Bun.write(
        filePath,
        JSON.stringify(
            {
                active: false,
                autonomyMode: 'Autopilot',
                defaultModelTitle: 'Agent',
                history: [
                    {
                        contextItems: [],
                        editorState: { type: 'doc' },
                        message: {
                            content: [
                                { text: 'Descope-Class Vendor-Detection review please', type: 'text' },
                                {
                                    imageUrl: { url: 'data:image/png;base64,AAA' },
                                    type: 'imageUrl',
                                },
                            ],
                            id: `${sessionId}-user`,
                            role: 'user',
                        },
                    },
                    {
                        contextItems: [],
                        editorState: { type: 'doc' },
                        executionId: `${sessionId}-execution`,
                        message: {
                            content: 'The vendor detection review is ready.',
                            id: `${sessionId}-assistant`,
                            role: 'assistant',
                        },
                        promptLogs: [
                            {
                                completion: 'The vendor detection review is ready.',
                                completionOptions: { model: 'agent' },
                                modelTitle: 'Agent',
                                prompt: '<user>Descope-Class Vendor-Detection review please',
                            },
                        ],
                    },
                ],
                selectedModel: 'claude-sonnet-4.5',
                selectedProfileId: 'local',
                sessionId,
                sessionType: 'spec',
                title,
                workspaceDirectory: workspacePath,
                workspacePath,
            },
            null,
            2,
        ),
    );
    const date = new Date(updatedAtMs);
    await utimes(filePath, date, date);
};

describe('kiro workspace discovery', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should resolve the default Kiro data directory', () => {
        expect(getDefaultKiroDataDir({}, '/Users/example')).toBe(
            '/Users/example/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent',
        );
    });

    it('should list workspace groups from Kiro workspace session JSON files', async () => {
        const sessionsDir = await makeTempRoot();
        await writeSession({
            createdAtMs: 1_781_212_901_555,
            sessionId: 'session-a',
            sessionsDir,
            title: 'Descope-Class Vendor-Detection review',
            updatedAtMs: 1_781_212_904_000,
            workspacePath: corpusCwd,
        });
        await writeSession({
            createdAtMs: 1_781_212_905_555,
            sessionId: 'session-b',
            sessionsDir,
            title: 'Follow up',
            updatedAtMs: 1_781_212_906_000,
            workspacePath: corpusCwd,
        });
        await writeSession({
            createdAtMs: 1_781_112_901_555,
            sessionId: 'session-c',
            sessionsDir,
            title: 'Other workspace',
            updatedAtMs: 1_781_112_904_000,
            workspacePath: otherCwd,
        });

        const workspaces = await listKiroWorkspaceGroups(sessionsDir);

        expect(workspaces).toHaveLength(2);
        expect(workspaces[0]).toMatchObject({
            assistantMessageCount: 2,
            imageCount: 2,
            label: 'ushman-corpus',
            messageCount: 4,
            promptLogCount: 2,
            sessionCount: 2,
            worktree: corpusCwd,
        });
        expect(findKiroWorkspaceGroups(workspaces, '~/workspace/ushman-corpus')).toHaveLength(1);
        expect(findKiroWorkspaceGroups(workspaces, 'other')[0]?.worktree).toBe(otherCwd);
    });

    it('should list sessions for a workspace and parse a selected transcript', async () => {
        const sessionsDir = await makeTempRoot();
        await writeSession({
            createdAtMs: 1_781_212_901_555,
            sessionId: 'session-a',
            sessionsDir,
            title: 'Descope-Class Vendor-Detection review',
            updatedAtMs: 1_781_212_904_000,
            workspacePath: corpusCwd,
        });

        const workspaces = await listKiroWorkspaceGroups(sessionsDir);
        const sessions = await listKiroSessionsForGroup(workspaces[0]?.key ?? '', sessionsDir);
        const transcript = await readKiroSessionTranscript(sessionsDir, 'session-a');

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            assistantMessageCount: 1,
            defaultModelTitle: 'Agent',
            imageCount: 1,
            messageCount: 2,
            promptLogCount: 1,
            selectedModel: 'claude-sonnet-4.5',
            sessionId: 'session-a',
            sessionType: 'spec',
            title: 'Descope-Class Vendor-Detection review',
            userMessageCount: 1,
        });
        expect(transcript?.session.sessionId).toBe('session-a');
        expect(transcript?.entries).toHaveLength(2);
        expect(transcript?.entries[0]?.parts.map((part) => part.type)).toEqual(['text', 'image']);
        expect(transcript?.entries[0]?.parts[0]).toMatchObject({
            text: 'Descope-Class Vendor-Detection review please',
            type: 'text',
        });
        expect(transcript?.entries[0]?.parts[1]).toMatchObject({
            imageUrl: 'data:image/png;base64,AAA',
            type: 'image',
        });
        expect(transcript?.entries[1]?.parts[0]).toMatchObject({
            text: 'The vendor detection review is ready.',
            type: 'text',
        });
        expect(transcript?.rawSession.sessionId).toBe('session-a');
    });

    it('should keep Kiro text blocks in one user entry and append execution assistant messages', async () => {
        const sessionsDir = await makeTempRoot();
        const sessionId = 'session-with-execution';
        const workspacePath = path.join(homeDir, 'workspace', 'ushman');
        const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));
        await mkdir(workspaceDir, { recursive: true });
        await Bun.write(
            path.join(workspaceDir, 'sessions.json'),
            JSON.stringify(
                [
                    {
                        dateCreated: '1781464088075',
                        sessionId,
                        title: 'Performance bottleneck review',
                        workspaceDirectory: workspacePath,
                    },
                ],
                null,
                2,
            ),
        );
        await Bun.write(
            path.join(workspaceDir, `${sessionId}.json`),
            JSON.stringify(
                {
                    defaultModelTitle: 'Agent',
                    history: [
                        {
                            message: {
                                content: [
                                    {
                                        text: 'First read AGENTS.md. We just did a lot of performance enhancements and fixes for our pipeline: /workspace/performance-bottlenecks.md',
                                        type: 'text',
                                    },
                                    { text: 'Dev notes:', type: 'text' },
                                    { text: '**Problem Statement**', type: 'text' },
                                ],
                                id: `${sessionId}-user`,
                                role: 'user',
                            },
                        },
                        {
                            executionId: 'placeholder-execution',
                            message: {
                                content: 'On it.',
                                id: `${sessionId}-assistant`,
                                role: 'assistant',
                            },
                        },
                    ],
                    selectedModel: 'claude-sonnet-4.5',
                    sessionId,
                    sessionType: 'spec',
                    title: 'Performance bottleneck review',
                    workspaceDirectory: workspacePath,
                    workspacePath,
                },
                null,
                2,
            ),
        );

        const executionDir = path.join(
            sessionsDir,
            getKiroWorkspaceHash(workspacePath),
            '414d1636299d2b9e4ce7e17fb11f63e9',
        );
        await mkdir(executionDir, { recursive: true });
        await Bun.write(
            path.join(executionDir, 'execution-rich'),
            JSON.stringify(
                {
                    actions: [
                        {
                            actionId: 'read-file',
                            actionType: 'readFile',
                            chatSessionId: sessionId,
                            input: {
                                files: [
                                    {
                                        path: '/workspace/performance-bottlenecks.md',
                                        range: { endLine: 2900, startLine: 1799 },
                                    },
                                ],
                            },
                        },
                        {
                            actionId: 'assistant-1',
                            actionType: 'assistantMessage',
                            chatSessionId: sessionId,
                            emittedAt: 1_781_464_088_100,
                            output: {
                                message:
                                    "I'll conduct a comprehensive code review of the performance optimization work.",
                            },
                        },
                        {
                            actionId: 'assistant-2',
                            actionType: 'assistantMessage',
                            chatSessionId: sessionId,
                            emittedAt: 1_781_464_088_200,
                            output: { message: 'Let me continue reading the critical files to complete my analysis.' },
                        },
                        {
                            actionId: 'search-code',
                            actionType: 'grepSearch',
                            chatSessionId: sessionId,
                            input: {
                                query: 'shortIdentifierScan',
                                why: 'Searching for the shortIdentifierScan retention implementation',
                            },
                        },
                        {
                            actionId: 'assistant-3',
                            actionType: 'assistantMessage',
                            chatSessionId: sessionId,
                            emittedAt: 1_781_464_088_300,
                            output: { message: 'Based on my review of the code, here is the analysis.' },
                        },
                    ],
                    chatSessionId: sessionId,
                    endTime: 1_781_464_236_222,
                    executionId: 'rich-execution',
                    startTime: 1_781_464_088_075,
                    status: 'succeed',
                },
                null,
                2,
            ),
        );

        const transcript = await readKiroSessionTranscript(sessionsDir, sessionId);

        expect(transcript?.entries.map((entry) => entry.role)).toEqual([
            'user',
            'tool',
            'assistant',
            'assistant',
            'tool',
            'assistant',
        ]);
        expect(transcript?.entries.map((entry) => entry.entryType)).toEqual([
            'message',
            'tool_call',
            'message',
            'message',
            'tool_call',
            'message',
        ]);
        expect(transcript?.entries[0]?.parts).toHaveLength(1);
        expect(transcript?.entries[0]?.parts[0]?.text).toContain('performance-bottlenecks.md');
        expect(transcript?.entries[0]?.parts[0]?.text).toContain('Dev notes:');
        expect(transcript?.entries[0]?.parts[0]?.text).toContain('**Problem Statement**');
        expect(transcript?.entries.map((entry) => entry.parts[0]?.text)).not.toContain('On it.');
        expect(transcript?.entries[1]?.parts[0]?.text).toContain(
            'Read file: /workspace/performance-bottlenecks.md:1800-2901',
        );
        expect(transcript?.entries[4]?.parts[0]?.text).toContain(
            'Search: Searching for the shortIdentifierScan retention implementation',
        );
        expect(
            transcript?.entries.filter((entry) => entry.role === 'assistant').map((entry) => entry.parts[0]?.text),
        ).toEqual([
            "I'll conduct a comprehensive code review of the performance optimization work.",
            'Let me continue reading the critical files to complete my analysis.',
            'Based on my review of the code, here is the analysis.',
        ]);
        expect(transcript?.session).toMatchObject({
            assistantMessageCount: 3,
            messageCount: 4,
            userMessageCount: 1,
        });
    });

    it('should interleave Kiro execution entries at their matching assistant placeholders', async () => {
        const sessionsDir = await makeTempRoot();
        const sessionId = 'session-multi-turn-execution';
        const workspacePath = path.join(homeDir, 'workspace', 'ushman-multi');
        const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));
        await mkdir(workspaceDir, { recursive: true });
        await Bun.write(
            path.join(workspaceDir, 'sessions.json'),
            JSON.stringify(
                [
                    {
                        dateCreated: '1781464088',
                        sessionId,
                        title: 'Multi-turn execution review',
                        workspaceDirectory: workspacePath,
                    },
                ],
                null,
                2,
            ),
        );
        await Bun.write(
            path.join(workspaceDir, `${sessionId}.json`),
            JSON.stringify(
                {
                    defaultModelTitle: 'Agent',
                    history: [
                        {
                            message: {
                                content: 'First task',
                                id: 'user-1',
                                role: 'user',
                            },
                        },
                        {
                            executionId: 'execution-one',
                            message: {
                                content: 'On it.',
                                id: 'placeholder-1',
                                role: 'assistant',
                            },
                        },
                        {
                            message: {
                                content: 'Second task',
                                id: 'user-2',
                                role: 'user',
                            },
                        },
                        {
                            executionId: 'execution-two',
                            message: {
                                content: 'On it!',
                                id: 'placeholder-2',
                                role: 'assistant',
                            },
                        },
                    ],
                    selectedModel: 'claude-sonnet-4.5',
                    sessionId,
                    title: 'Multi-turn execution review',
                    workspaceDirectory: workspacePath,
                    workspacePath,
                },
                null,
                2,
            ),
        );

        const executionRoot = path.join(sessionsDir, getKiroWorkspaceHash(workspacePath));
        await mkdir(path.join(executionRoot, 'one'), { recursive: true });
        await mkdir(path.join(executionRoot, 'two'), { recursive: true });
        await Bun.write(
            path.join(executionRoot, 'one', 'execution.json'),
            JSON.stringify({
                actions: [
                    {
                        actionId: 'assistant-one',
                        actionType: 'assistantMessage',
                        chatSessionId: sessionId,
                        output: { message: 'First task complete' },
                    },
                ],
                chatSessionId: sessionId,
                executionId: 'execution-one',
                startTime: 1_781_464_088_000,
            }),
        );
        await Bun.write(
            path.join(executionRoot, 'two', 'execution.json'),
            JSON.stringify({
                actions: [
                    {
                        actionId: 'assistant-two',
                        actionType: 'assistantMessage',
                        chatSessionId: sessionId,
                        output: { message: 'Second task complete' },
                    },
                ],
                chatSessionId: sessionId,
                executionId: 'execution-two',
                startTime: 1_781_464_089_000,
            }),
        );

        const transcript = await readKiroSessionTranscript(sessionsDir, sessionId);

        expect(transcript?.session.createdAtMs).toBe(1_781_464_088_000);
        expect(transcript?.entries.map((entry) => entry.parts[0]?.text)).toEqual([
            'First task',
            'First task complete',
            'Second task',
            'Second task complete',
        ]);
    });

    it('should return empty results when Kiro data is missing', async () => {
        const missingSessionsDir = path.join(os.tmpdir(), `spiracha-missing-kiro-sessions-${randomUUID()}`);

        expect(await listKiroWorkspaceGroups(missingSessionsDir)).toEqual([]);
        expect(await listKiroSessionsForGroup('workspace:missing', missingSessionsDir)).toEqual([]);
        expect(await readKiroSessionTranscript(missingSessionsDir, 'missing')).toBeNull();
    });
});
