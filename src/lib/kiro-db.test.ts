import { afterEach, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    deleteKiroSession,
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
    activeTabs,
    assistantText = 'The vendor detection review is ready.',
    createdAtMs,
    sessionsDir,
    sessionId,
    title,
    updatedAtMs,
    userText = 'Descope-Class Vendor-Detection review please',
    workspacePath,
}: {
    activeTabs?: string[];
    assistantText?: string;
    createdAtMs: number;
    sessionsDir: string;
    sessionId: string;
    title: string;
    updatedAtMs: number;
    userText?: string;
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
                activeTabs: activeTabs ?? [sessionId],
                autonomyMode: 'Autopilot',
                defaultModelTitle: 'Agent',
                history: [
                    {
                        contextItems: [],
                        editorState: { type: 'doc' },
                        message: {
                            content: [
                                { text: userText, type: 'text' },
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
                            content: assistantText,
                            id: `${sessionId}-assistant`,
                            role: 'assistant',
                        },
                        promptLogs: [
                            {
                                completion: assistantText,
                                completionOptions: { model: 'agent' },
                                modelTitle: 'Agent',
                                prompt: `<user>${userText}`,
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
    it('should treat empty timestamps as missing and omit empty sessions from listings', async () => {
        const sessionsDir = await makeTempRoot();
        const workspacePath = '/workspace/empty';
        const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));
        await mkdir(workspaceDir, { recursive: true });
        await Bun.write(
            path.join(workspaceDir, 'sessions.json'),
            JSON.stringify([{ dateCreated: '', sessionId: 'empty-session', workspaceDirectory: workspacePath }]),
        );
        await Bun.write(
            path.join(workspaceDir, 'empty-session.json'),
            JSON.stringify({ history: [], sessionId: 'empty-session' }),
        );

        const transcript = await readKiroSessionTranscript(sessionsDir, 'empty-session');
        const groups = await listKiroWorkspaceGroups(sessionsDir);

        expect(transcript?.session.createdAtMs).not.toBe(0);
        expect(groups).toEqual([]);
    });

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
        expect(transcript?.rawHistory).toHaveLength(2);
        expect(transcript?.historyEntries).toEqual(transcript?.entries);
        expect(transcript?.executionEntries).toEqual([]);
        expect(transcript && 'rawExecutions' in transcript).toBe(false);
    });

    it('should always merge explicit Kiro continuation chains under the parent session', async () => {
        const sessionsDir = await makeTempRoot();
        const rootId = 'session-root';
        const childId = 'session-child';
        const leafId = 'session-leaf';
        const chain = [rootId, childId, leafId];
        const fixtures = [
            {
                activeTabs: [rootId],
                assistantText: 'Root response',
                createdAtMs: 1_781_212_901_000,
                sessionId: rootId,
                title: 'Original task',
                updatedAtMs: 1_781_212_902_000,
                userText: 'Original request',
            },
            {
                activeTabs: [rootId, childId],
                assistantText: 'Child response',
                createdAtMs: 1_781_212_903_000,
                sessionId: childId,
                title: 'Original task (checkpoint) (Continued)',
                updatedAtMs: 1_781_212_904_000,
                userText: '# Conversation Summary\n\nEarlier context.',
            },
            {
                activeTabs: chain,
                assistantText: 'Leaf response',
                createdAtMs: 1_781_212_905_000,
                sessionId: leafId,
                title: 'Original task (checkpoint) (Continued) (Continued)',
                updatedAtMs: 1_781_212_906_000,
                userText: '## Summary of Conversation\n\nMore context.',
            },
        ];
        for (const fixture of fixtures) {
            await writeSession({ ...fixture, sessionsDir, workspacePath: corpusCwd });
        }

        const workspaces = await listKiroWorkspaceGroups(sessionsDir);
        const workspaceKey = workspaces[0]?.key ?? '';
        const sessions = await listKiroSessionsForGroup(workspaceKey, sessionsDir);
        const parentTranscript = await readKiroSessionTranscript(sessionsDir, rootId);
        const physicalChild = await readKiroSessionTranscript(sessionsDir, childId);

        expect(workspaces[0]).toMatchObject({ sessionCount: 1 });
        expect(physicalChild?.session.sessionId).toBe(childId);
        expect(physicalChild?.entries[0]?.parts[0]?.text).toStartWith('# Conversation Summary');
        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            continuationSessionIds: chain,
            createdAtMs: 1_781_212_901_000,
            lastActiveAtMs: 1_781_212_906_000,
            messageCount: 4,
            sessionId: rootId,
            title: 'Original task',
            userMessageCount: 1,
        });
        expect(parentTranscript?.session).toMatchObject({
            continuationSessionIds: chain,
            sessionId: rootId,
            title: 'Original task',
        });
        expect(
            parentTranscript?.entries.flatMap((entry) => entry.parts.map((part) => part.text)).filter(Boolean),
        ).toEqual(['Original request', 'Image attachment', 'Root response', 'Child response', 'Leaf response']);

        const deleted = await deleteKiroSession(sessionsDir, rootId);
        expect(deleted.deletedSessionIds).toEqual(chain);
        await expect(
            Promise.all(chain.map((sessionId) => readKiroSessionTranscript(sessionsDir, sessionId))),
        ).resolves.toEqual([null, null, null]);
    });

    it('should keep ambiguous Kiro tab branches as physical sessions', async () => {
        const sessionsDir = await makeTempRoot();
        const rootId = 'session-root';
        for (const fixture of [
            {
                activeTabs: [rootId],
                sessionId: rootId,
                title: 'Original task',
                userText: 'Original request',
            },
            {
                activeTabs: [rootId, 'branch-a'],
                sessionId: 'branch-a',
                title: 'Original task (Continued)',
                userText: '# Conversation Summary\n\nBranch A.',
            },
            {
                activeTabs: [rootId, 'branch-b'],
                sessionId: 'branch-b',
                title: 'Original task (Continued)',
                userText: '# Conversation Summary\n\nBranch B.',
            },
        ]) {
            await writeSession({
                ...fixture,
                assistantText: `${fixture.sessionId} response`,
                createdAtMs: 1_781_212_901_000,
                sessionsDir,
                updatedAtMs: 1_781_212_902_000,
                workspacePath: corpusCwd,
            });
        }

        const workspaces = await listKiroWorkspaceGroups(sessionsDir);
        const sessions = await listKiroSessionsForGroup(workspaces[0]?.key ?? '', sessionsDir);

        expect(sessions).toHaveLength(3);
        expect(sessions.every((session) => session.continuationSessionIds.length === 1)).toBe(true);
    });

    it('should delete only a directly requested Kiro continuation segment', async () => {
        const sessionsDir = await makeTempRoot();
        const rootId = 'session-root';
        const childId = 'session-child';
        await writeSession({
            activeTabs: [rootId],
            createdAtMs: 1_781_212_901_000,
            sessionId: rootId,
            sessionsDir,
            title: 'Original task',
            updatedAtMs: 1_781_212_902_000,
            userText: 'Original request',
            workspacePath: corpusCwd,
        });
        await writeSession({
            activeTabs: [rootId, childId],
            createdAtMs: 1_781_212_903_000,
            sessionId: childId,
            sessionsDir,
            title: 'Original task (Continued)',
            updatedAtMs: 1_781_212_904_000,
            userText: '# Conversation Summary\n\nEarlier context.',
            workspacePath: corpusCwd,
        });

        const result = await deleteKiroSession(sessionsDir, childId);

        expect(result.deletedSessionIds).toEqual([childId]);
        await expect(readKiroSessionTranscript(sessionsDir, rootId)).resolves.not.toBeNull();
        await expect(readKiroSessionTranscript(sessionsDir, childId)).resolves.toBeNull();
    });

    it('should delete a Kiro session file, index entry, and matching execution files', async () => {
        const sessionsDir = await makeTempRoot();
        const workspacePath = corpusCwd;
        const sessionId = 'session-delete';
        await writeSession({
            createdAtMs: 1_781_212_901_555,
            sessionId,
            sessionsDir,
            title: 'Delete this session',
            updatedAtMs: 1_781_212_904_000,
            workspacePath,
        });
        const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));
        const sessionPath = path.join(workspaceDir, `${sessionId}.json`);
        const executionPath = path.join(sessionsDir, getKiroWorkspaceHash(workspacePath), 'execution', 'delete.json');
        await mkdir(path.dirname(executionPath), { recursive: true });
        await Bun.write(
            executionPath,
            JSON.stringify({
                actions: [],
                chatSessionId: sessionId,
                executionId: 'delete-execution',
            }),
        );

        const result = await deleteKiroSession(sessionsDir, sessionId);

        expect(result.deletedSessionIds).toEqual([sessionId]);
        expect(result.deletedFiles.sort()).toEqual([executionPath, sessionPath].sort());
        expect(await Bun.file(sessionPath).exists()).toBe(false);
        expect(await Bun.file(executionPath).exists()).toBe(false);
        expect(await Bun.file(path.join(workspaceDir, 'sessions.json')).json()).toEqual([]);
        expect(await readKiroSessionTranscript(sessionsDir, sessionId)).toBeNull();
    });

    it('should serialize concurrent deletes that update the same session index', async () => {
        const sessionsDir = await makeTempRoot();
        const workspacePath = corpusCwd;
        for (const sessionId of ['session-delete-a', 'session-delete-b']) {
            await writeSession({
                createdAtMs: 1_781_212_901_555,
                sessionId,
                sessionsDir,
                title: sessionId,
                updatedAtMs: 1_781_212_904_000,
                workspacePath,
            });
        }

        const results = await Promise.all(
            ['session-delete-a', 'session-delete-b'].map((sessionId) => deleteKiroSession(sessionsDir, sessionId)),
        );
        const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));

        expect(results.flatMap((result) => result.deletedSessionIds).sort()).toEqual([
            'session-delete-a',
            'session-delete-b',
        ]);
        expect(await Bun.file(path.join(workspaceDir, 'sessions.json')).json()).toEqual([]);
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
                            actionId: 'run-command',
                            actionType: 'runCommand',
                            chatSessionId: sessionId,
                            emittedAt: 1_781_464_088_150,
                            input: {
                                command: 'kodeguard status --json 2>&1 | jq -C',
                                cwd: workspacePath,
                                terminalId: 1,
                            },
                            output: {
                                exitCode: 1,
                                output: '{\n  "status": "error",\n  "failure": { "kind": "toolchain-drift" }\n}',
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
                            output: {
                                message:
                                    "These helpers should all be removed since they're internal. Let me remove them:",
                            },
                        },
                        {
                            actionId: 'replace-file',
                            actionType: 'replace',
                            chatSessionId: sessionId,
                            emittedAt: 1_781_464_088_350,
                            input: {
                                file: 'src/cleanup-briefs/decompose-gate.ts',
                                local: 'file:///workspace/src/cleanup-briefs/decompose-gate.ts',
                                modified: 'kiro-diff:/src/cleanup-briefs/decompose-gate.ts?commitId=next',
                                original: 'kiro-diff:/src/cleanup-briefs/decompose-gate.ts?commitId=previous',
                            },
                        },
                    ],
                    chatSessionId: sessionId,
                    context: { compactedSnapshot: 'x'.repeat(1_000_000) },
                    endTime: 1_781_464_236_222,
                    executionId: 'placeholder-execution',
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
            'tool',
            'tool',
            'assistant',
            'tool',
            'assistant',
            'tool',
        ]);
        expect(transcript?.historyEntries.map((entry) => entry.role)).toEqual(['user', 'assistant']);
        expect(transcript?.executionEntries.map((entry) => entry.role)).toEqual([
            'tool',
            'assistant',
            'tool',
            'tool',
            'assistant',
            'tool',
            'assistant',
            'tool',
        ]);
        expect(transcript && 'rawExecutions' in transcript).toBe(false);
        expect(JSON.stringify(transcript).length).toBeLessThan(200_000);
        expect(transcript?.entries.map((entry) => entry.entryType)).toEqual([
            'message',
            'tool_call',
            'message',
            'tool_call',
            'tool_output',
            'message',
            'tool_call',
            'message',
            'tool_call',
        ]);
        expect(transcript?.entries[0]?.parts).toHaveLength(1);
        expect(transcript?.entries[0]?.parts[0]?.text).toContain('performance-bottlenecks.md');
        expect(transcript?.entries[0]?.parts[0]?.text).toContain('Dev notes:');
        expect(transcript?.entries[0]?.parts[0]?.text).toContain('**Problem Statement**');
        expect(transcript?.entries.map((entry) => entry.parts[0]?.text)).not.toContain('On it.');
        expect(transcript?.entries[1]?.parts[0]?.text).toContain(
            'Read file: /workspace/performance-bottlenecks.md:1800-2901',
        );
        expect(transcript?.entries[3]?.parts[0]).toMatchObject({
            raw: {
                command: 'kodeguard status --json 2>&1 | jq -C',
                toolCallId: 'placeholder-execution:run-command',
                toolName: 'run_command',
                workdir: workspacePath,
            },
            text: 'kodeguard status --json 2>&1 | jq -C',
        });
        expect(transcript?.entries[4]?.parts[0]).toMatchObject({
            raw: {
                exitCode: 1,
                toolCallId: 'placeholder-execution:run-command',
                toolName: 'run_command',
            },
            text: expect.stringContaining('toolchain-drift'),
        });
        expect(transcript?.entries[6]?.parts[0]?.text).toContain(
            'Search: Searching for the shortIdentifierScan retention implementation',
        );
        expect(transcript?.entries[8]?.parts[0]).toMatchObject({
            raw: {
                command: 'Replace file: src/cleanup-briefs/decompose-gate.ts',
                toolCallId: 'placeholder-execution:replace-file',
                toolName: 'replace',
            },
            text: 'Replace file: src/cleanup-briefs/decompose-gate.ts',
        });
        expect(
            transcript?.entries.filter((entry) => entry.role === 'assistant').map((entry) => entry.parts[0]?.text),
        ).toEqual([
            "I'll conduct a comprehensive code review of the performance optimization work.",
            'Let me continue reading the critical files to complete my analysis.',
            "These helpers should all be removed since they're internal. Let me remove them:",
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

    it('should pair unmatched Kiro placeholders with complete executions in order', async () => {
        const sessionsDir = await makeTempRoot();
        const sessionId = 'session-mismatched-execution';
        const workspacePath = path.join(homeDir, 'workspace', 'ushman-mismatched');
        const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));
        await mkdir(workspaceDir, { recursive: true });
        await Bun.write(
            path.join(workspaceDir, 'sessions.json'),
            JSON.stringify([{ dateCreated: '1781464088', sessionId, title: 'Mismatched execution' }]),
        );
        await Bun.write(
            path.join(workspaceDir, `${sessionId}.json`),
            JSON.stringify({
                history: [
                    {
                        message: { content: 'First task', id: 'user-1', role: 'user' },
                        timestamp: '2026-06-14T12:00:00.000Z',
                    },
                    {
                        executionId: 'missing-execution',
                        message: { content: 'On it.', id: 'placeholder-1', role: 'assistant' },
                        timestamp: '2026-06-14T12:00:01.000Z',
                    },
                    {
                        message: { content: 'Second task', id: 'user-2', role: 'user' },
                        timestamp: '2026-06-14T12:00:03.000Z',
                    },
                    {
                        executionId: 'execution-two',
                        message: { content: 'On it!', id: 'placeholder-2', role: 'assistant' },
                        timestamp: '2026-06-14T12:00:04.000Z',
                    },
                ],
                sessionId,
                workspaceDirectory: workspacePath,
                workspacePath,
            }),
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
                executionId: 'actual-execution-one',
                startTime: '2026-06-14T12:00:02.000Z',
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
                startTime: '2026-06-14T12:00:05.000Z',
            }),
        );

        const transcript = await readKiroSessionTranscript(sessionsDir, sessionId);

        expect(transcript?.entries.map((entry) => entry.parts[0]?.text)).toEqual([
            'First task',
            'First task complete',
            'Second task',
            'Second task complete',
        ]);
    });

    it('should locate and delete a Kiro session by its body session id when the filename differs', async () => {
        const sessionsDir = await makeTempRoot();
        const sessionId = 'canonical-session-id';
        const workspacePath = path.join(homeDir, 'workspace', 'kiro-body-id');
        const workspaceDir = path.join(sessionsDir, encodeKiroWorkspaceDirectoryName(workspacePath));
        const filePath = path.join(workspaceDir, 'stale-storage-name.json');
        await mkdir(workspaceDir, { recursive: true });
        await Bun.write(
            path.join(workspaceDir, 'sessions.json'),
            JSON.stringify([{ dateCreated: '1781464088', sessionId, title: 'Canonical session' }]),
        );
        await Bun.write(
            filePath,
            JSON.stringify({
                history: [
                    {
                        message: { content: 'Use the body id', id: 'user-1', role: 'user' },
                        timestamp: '2026-06-14T12:00:00.000Z',
                    },
                ],
                sessionId,
                workspaceDirectory: workspacePath,
                workspacePath,
            }),
        );

        const transcript = await readKiroSessionTranscript(sessionsDir, sessionId);
        const deleted = await deleteKiroSession(sessionsDir, sessionId);

        expect(transcript?.session.sessionId).toBe(sessionId);
        expect(deleted.deletedSessionIds).toEqual([sessionId]);
        expect(deleted.deletedFiles).toContain(filePath);
        expect(await Bun.file(filePath).exists()).toBe(false);
    });

    it('should return empty results when Kiro data is missing', async () => {
        const missingSessionsDir = path.join(os.tmpdir(), `spiracha-missing-kiro-sessions-${randomUUID()}`);

        expect(await listKiroWorkspaceGroups(missingSessionsDir)).toEqual([]);
        expect(await listKiroSessionsForGroup('workspace:missing', missingSessionsDir)).toEqual([]);
        expect(await readKiroSessionTranscript(missingSessionsDir, 'missing')).toBeNull();
    });
});
