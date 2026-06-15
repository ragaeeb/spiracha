import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    findOpenCodeWorkspaceGroups,
    getDefaultOpenCodeDataDir,
    getOpenCodeReadonlyDbUri,
    listOpenCodeSessionsForGroup,
    listOpenCodeWorkspaceGroups,
    readOpenCodeSessionTranscript,
} from './opencode-db';
import { createOpenCodeFixture } from './opencode-test-helpers';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const makeDbPath = async (): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'opencode-fixture-'));
    tempDirs.push(dir);
    return path.join(dir, 'opencode.db');
};

const createFixtureDb = async () => {
    const dbPath = await makeDbPath();
    await createOpenCodeFixture(dbPath, {
        projects: [
            {
                id: 'pro_demo',
                name: null,
                timeUpdated: 1_700_000_000_000,
                worktree: '/Users/test/workspace/demo',
            },
        ],
        sessions: [
            {
                agent: 'build',
                cost: 0.42,
                id: 'ses_main',
                messages: [
                    {
                        id: 'msg_user',
                        parts: [
                            {
                                data: { text: 'Review Descope-Class Vendor-Detection fixtures', type: 'text' },
                                id: 'prt_user_text',
                            },
                        ],
                        role: 'user',
                        timeCreated: 1_700_000_000_100,
                    },
                    {
                        id: 'msg_assistant',
                        parts: [
                            {
                                data: { text: 'I need to inspect the fixtures.', type: 'reasoning' },
                                id: 'prt_reasoning',
                                timeCreated: 1_700_000_000_200,
                            },
                            {
                                data: { snapshot: 'abc123', type: 'step-start' },
                                id: 'prt_step_start',
                                timeCreated: 1_700_000_000_250,
                            },
                            {
                                data: {
                                    callID: 'call_read',
                                    state: {
                                        input: { filePath: '/Users/test/workspace/demo/AGENTS.md' },
                                        output: 'file contents',
                                        status: 'completed',
                                        title: 'Read AGENTS',
                                    },
                                    tool: 'read',
                                    type: 'tool',
                                },
                                id: 'prt_tool',
                                timeCreated: 1_700_000_000_300,
                            },
                            {
                                data: {
                                    reason: 'stop',
                                    snapshot: 'abc123',
                                    tokens: {
                                        cache: { read: 3, write: 4 },
                                        input: 10,
                                        output: 5,
                                        reasoning: 2,
                                        total: 20,
                                    },
                                    type: 'step-finish',
                                },
                                id: 'prt_step_finish',
                                timeCreated: 1_700_000_000_350,
                            },
                            {
                                data: { text: 'The fixture review is complete.', type: 'text' },
                                id: 'prt_assistant_text',
                                timeCreated: 1_700_000_000_400,
                            },
                        ],
                        role: 'assistant',
                        timeCreated: 1_700_000_000_200,
                    },
                ],
                model: { id: 'gpt-5-codex', providerID: 'opencode', variant: 'high' },
                projectId: 'pro_demo',
                slug: 'quiet-mountain',
                summaryFiles: 2,
                timeCreated: 1_700_000_000_000,
                timeUpdated: 1_700_000_100_000,
                title: 'Comprehensive code review',
                tokensInput: 10,
                tokensOutput: 5,
                tokensReasoning: 2,
            },
            {
                id: 'ses_child',
                messages: [],
                parentId: 'ses_main',
                projectId: 'pro_demo',
                timeUpdated: 1_700_000_200_000,
                title: 'Subagent session',
            },
        ],
    });
    return dbPath;
};

describe('opencode db helpers', () => {
    it('should resolve the default XDG data directory', () => {
        expect(getDefaultOpenCodeDataDir({}, '/Users/alice')).toBe('/Users/alice/.local/share/opencode');
        expect(getDefaultOpenCodeDataDir({ XDG_DATA_HOME: '/tmp/xdg' }, '/Users/alice')).toBe('/tmp/xdg/opencode');
    });

    it('should build a read-only SQLite URI for paths with spaces', () => {
        expect(getOpenCodeReadonlyDbUri('/Users/alice/Local Data/opencode.db')).toBe(
            'file:///Users/alice/Local%20Data/opencode.db?mode=ro',
        );
    });

    it('should group top-level sessions by project workspace', async () => {
        const dbPath = await createFixtureDb();

        const groups = await listOpenCodeWorkspaceGroups(dbPath);

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            key: 'project:pro_demo',
            label: 'demo',
            lastActiveMs: 1_700_000_100_000,
            sessionCount: 1,
            worktree: '/Users/test/workspace/demo',
        });
        expect(groups[0]?.messageCount).toBe(2);
        expect(groups[0]?.partCount).toBe(6);
    });

    it('should match workspaces by basename or path query', async () => {
        const dbPath = await createFixtureDb();
        const groups = await listOpenCodeWorkspaceGroups(dbPath);

        expect(findOpenCodeWorkspaceGroups(groups, 'demo')).toHaveLength(1);
        expect(findOpenCodeWorkspaceGroups(groups, '/Users/test/workspace/demo')).toHaveLength(1);
    });

    it('should list top-level sessions for a workspace', async () => {
        const dbPath = await createFixtureDb();

        const sessions = await listOpenCodeSessionsForGroup('project:pro_demo', dbPath);

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            agent: 'build',
            messageCount: 2,
            modelLabel: 'gpt-5-codex high',
            partCount: 6,
            renderablePartCount: 4,
            sessionId: 'ses_main',
            title: 'Comprehensive code review',
            toolPartCount: 1,
            workspaceLabel: 'demo',
        });
    });

    it('should read a session transcript with parsed parts in message order', async () => {
        const dbPath = await createFixtureDb();

        const transcript = await readOpenCodeSessionTranscript(dbPath, 'ses_main');

        expect(transcript?.session.sessionId).toBe('ses_main');
        expect(transcript?.messages).toHaveLength(2);
        expect(transcript?.renderablePartCount).toBe(4);
        expect(transcript?.messages[1]?.parts.map((part) => part.type)).toEqual([
            'reasoning',
            'step-start',
            'tool',
            'step-finish',
            'text',
        ]);
        expect(transcript?.messages[1]?.parts[2]).toMatchObject({
            callId: 'call_read',
            outputText: 'file contents',
            status: 'completed',
            toolName: 'read',
            type: 'tool',
        });
    });
});
