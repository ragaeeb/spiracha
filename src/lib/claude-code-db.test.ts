import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    findClaudeCodeWorkspaceGroups,
    getDefaultClaudeCodeDataDir,
    listClaudeCodeSessionsForGroup,
    listClaudeCodeWorkspaceGroups,
    readClaudeCodeSessionTranscript,
} from './claude-code-db';

const tempRoots: string[] = [];
const homeDir = os.homedir();
const corpusCwd = path.join(homeDir, 'workspace', 'ushman-corpus');
const otherCwd = path.join(homeDir, 'workspace', 'other');

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-code-db-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

const writeJsonl = async (filePath: string, records: unknown[]) => {
    await Bun.write(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
};

const writeSession = async (
    projectsDir: string,
    projectDirName: string,
    sessionId: string,
    records: Record<string, unknown>[],
) => {
    const projectDir = path.join(projectsDir, projectDirName);
    await mkdir(projectDir, { recursive: true });
    await writeJsonl(path.join(projectDir, `${sessionId}.jsonl`), records);
};

const buildSessionRecords = (sessionId: string, cwd: string, firstTimestamp = '2026-06-01T10:00:00.000Z') => [
    {
        cwd,
        message: {
            content: 'Descope-Class Vendor-Detection review please',
            role: 'user',
        },
        sessionId,
        timestamp: firstTimestamp,
        type: 'user',
        uuid: `${sessionId}-user-1`,
    },
    {
        cwd,
        message: {
            content: [
                { thinking: 'Need inspect the vendor detection path.', type: 'thinking' },
                {
                    id: 'toolu_1',
                    input: { command: 'rg "Descope-Class Vendor-Detection" .' },
                    name: 'Bash',
                    type: 'tool_use',
                },
                { text: 'I found the vendor detection thread.', type: 'text' },
            ],
            model: 'claude-sonnet-4-5',
            role: 'assistant',
            usage: {
                cache_creation_input_tokens: 2,
                cache_read_input_tokens: 3,
                input_tokens: 10,
                output_tokens: 4,
            },
        },
        parentUuid: `${sessionId}-user-1`,
        sessionId,
        timestamp: '2026-06-01T10:00:04.000Z',
        type: 'assistant',
        uuid: `${sessionId}-assistant-1`,
        version: '2.1.148',
    },
    {
        cwd,
        message: {
            content: [
                {
                    content: 'src/vendor.ts: Descope-Class Vendor-Detection',
                    is_error: false,
                    tool_use_id: 'toolu_1',
                    type: 'tool_result',
                },
            ],
            role: 'user',
        },
        parentUuid: `${sessionId}-assistant-1`,
        sessionId,
        timestamp: '2026-06-01T10:00:05.000Z',
        type: 'user',
        uuid: `${sessionId}-user-2`,
    },
];

describe('claude code workspace discovery', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should resolve the default Claude Code data directory', () => {
        expect(getDefaultClaudeCodeDataDir({}, '/Users/example')).toBe('/Users/example/.claude');
    });

    it('should list workspace groups from local Claude Code project JSONL files', async () => {
        const projectsDir = await makeTempRoot();
        await writeSession(
            projectsDir,
            '-Users-rhaq-workspace-ushman-corpus',
            'session-a',
            buildSessionRecords('session-a', corpusCwd),
        );
        await writeSession(
            projectsDir,
            '-Users-rhaq-workspace-ushman-corpus',
            'session-b',
            buildSessionRecords('session-b', corpusCwd, '2026-06-02T10:00:00.000Z'),
        );
        await writeSession(
            projectsDir,
            '-Users-rhaq-workspace-other',
            'session-c',
            buildSessionRecords('session-c', otherCwd, '2026-05-30T10:00:00.000Z'),
        );

        const workspaces = await listClaudeCodeWorkspaceGroups(projectsDir);

        expect(workspaces).toHaveLength(2);
        expect(workspaces[0]).toMatchObject({
            label: 'ushman-corpus',
            messageCount: 6,
            sessionCount: 2,
            toolCallCount: 2,
            worktree: corpusCwd,
        });
        expect(findClaudeCodeWorkspaceGroups(workspaces, '~/workspace/ushman-corpus')).toHaveLength(1);
        expect(findClaudeCodeWorkspaceGroups(workspaces, 'other')[0]?.worktree).toBe(otherCwd);
    });

    it('should list sessions for a workspace and parse a selected transcript', async () => {
        const projectsDir = await makeTempRoot();
        await writeSession(
            projectsDir,
            '-Users-rhaq-workspace-ushman-corpus',
            'session-a',
            buildSessionRecords('session-a', corpusCwd),
        );

        const workspaces = await listClaudeCodeWorkspaceGroups(projectsDir);
        const sessions = await listClaudeCodeSessionsForGroup(workspaces[0]?.key ?? '', projectsDir);
        const transcript = await readClaudeCodeSessionTranscript(projectsDir, 'session-a');

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            assistantMessageCount: 1,
            messageCount: 3,
            model: 'claude-sonnet-4-5',
            sessionId: 'session-a',
            title: 'Descope-Class Vendor-Detection review please',
            toolCallCount: 1,
            toolResultCount: 1,
            totalTokens: 19,
            userMessageCount: 2,
        });
        expect(transcript?.session.sessionId).toBe('session-a');
        expect(transcript?.entries).toHaveLength(3);
        expect(transcript?.entries[0]?.parts[0]).toMatchObject({
            text: 'Descope-Class Vendor-Detection review please',
            type: 'text',
        });
        expect(transcript?.entries[1]?.parts.map((part) => part.type)).toEqual(['thinking', 'tool_use', 'text']);
        expect(transcript?.entries[1]?.parts[1]).toMatchObject({
            argumentsText: '{\n  "command": "rg \\"Descope-Class Vendor-Detection\\" ."\n}',
            toolName: 'Bash',
            toolUseId: 'toolu_1',
        });
        expect(transcript?.entries[2]?.parts[0]).toMatchObject({
            outputText: 'src/vendor.ts: Descope-Class Vendor-Detection',
            toolUseId: 'toolu_1',
            type: 'tool_result',
        });
        expect(transcript?.rawEvents).toHaveLength(3);
    });

    it('should return empty results when Claude Code data is missing', async () => {
        const missingProjectsDir = path.join(os.tmpdir(), 'spiracha-missing-claude-code-projects');

        expect(await listClaudeCodeWorkspaceGroups(missingProjectsDir)).toEqual([]);
        expect(await listClaudeCodeSessionsForGroup('project:missing', missingProjectsDir)).toEqual([]);
        expect(await readClaudeCodeSessionTranscript(missingProjectsDir, 'missing')).toBeNull();
    });
});
