import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    findQoderWorkspaceGroups,
    getDefaultQoderUserDir,
    listQoderSessionsForGroup,
    listQoderWorkspaceGroups,
    readQoderSessionTranscript,
} from './qoder-db';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'qoder-db-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
};

const writeGlobalStateDb = async (dbPath: string, entries: Record<string, unknown>) => {
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath, { create: true, strict: true });
    db.run('create table ItemTable (key text primary key, value text)');
    const insert = db.prepare('insert into ItemTable (key, value) values (?, ?)');
    for (const [key, value] of Object.entries(entries)) {
        insert.run(key, JSON.stringify(value));
    }
    db.close();
};

const writeQoderState = async (workspaceStorageDir: string) => {
    const stateDir = path.join(workspaceStorageDir, 'ws-a', 'chatEditingSessions', 'task-a.session.execution');
    await mkdir(stateDir, { recursive: true });
    await Bun.write(
        path.join(stateDir, 'state.json'),
        JSON.stringify(
            {
                recentSnapshot: {
                    entries: [
                        {
                            currentHash: 'def456',
                            languageId: 'typescript',
                            resource: 'file:///Users/example/workspace/project-a/src/index.ts',
                            telemetryInfo: { requestId: 'request-a' },
                        },
                    ],
                },
                sessionId: 'task-a.session.execution',
                timeline: {
                    operations: [
                        {
                            requestId: 'request-a',
                            type: 'create',
                            uri: {
                                fsPath: '/Users/example/workspace/project-a/src/index.ts',
                                scheme: 'file',
                            },
                        },
                        {
                            edits: [
                                {
                                    range: {
                                        endColumn: 1,
                                        endLineNumber: 1,
                                        startColumn: 1,
                                        startLineNumber: 1,
                                    },
                                    text: 'export const value = 1;\\n',
                                },
                            ],
                            requestId: 'request-a',
                            type: 'textEdit',
                            uri: {
                                fsPath: '/Users/example/workspace/project-a/src/index.ts',
                                scheme: 'file',
                            },
                        },
                    ],
                },
                version: 2,
            },
            null,
            2,
        ),
    );
};

describe('qoder workspace discovery', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should resolve the default Qoder user directory', () => {
        expect(getDefaultQoderUserDir({}, '/Users/example')).toBe(
            '/Users/example/Library/Application Support/Qoder/User',
        );
    });

    it('should list Qoder workspaces, sessions, and transcript entries from local history plus state files', async () => {
        const tempRoot = await makeTempRoot();
        const globalStateDb = path.join(tempRoot, 'globalStorage', 'state.vscdb');
        const workspaceStorageDir = path.join(tempRoot, 'workspaceStorage');
        await writeGlobalStateDb(globalStateDb, {
            'aicoding.questTaskListSnapshot': {
                folders: {
                    '/Users/example/workspace/other': {
                        tasks: [],
                        updatedAt: 1_781_567_466_878,
                    },
                    '/Users/example/workspace/project-a': {
                        tasks: [
                            {
                                agentClass: 'QuestAgent',
                                createdAt: 1_780_439_242_392,
                                executionMode: 'agent',
                                executionRequestId: 'request-a',
                                executionSessionId: 'task-a.session.execution',
                                id: 'task-a',
                                query: 'Split wizard step 9',
                                status: 'Completed',
                                title: 'Wizard Step 9 Split',
                                updatedAtTimestamp: 1_780_439_245_000,
                                workspaceUri: 'file:///Users/example/workspace/project-a',
                            },
                        ],
                        updatedAt: 1_781_567_466_878,
                    },
                },
                updatedAt: 1_781_567_466_878,
                version: 1,
            },
            'lingma.chat.localHistory.ws-a.quest': [
                {
                    id: 'history-1',
                    sessionId: 'task-a.session.execution',
                    timestamp: 1_780_439_242_392,
                    title: 'First read AGENTS.md.\\n/Users/example/workspace/project-a/src/index.ts',
                },
                {
                    id: 'history-2',
                    sessionId: 'task-a.session.execution',
                    timestamp: 1_780_439_243_392,
                    title: 'Continue\\n/Users/example/workspace/project-a/notes.md',
                },
                {
                    id: 'history-3',
                    sessionId: 'task-b.session.execution',
                    timestamp: 1_780_439_246_392,
                    title: 'Review\\n/Users/example/workspace/other/README.md',
                },
            ],
        });
        await writeQoderState(workspaceStorageDir);

        const workspaces = await listQoderWorkspaceGroups(globalStateDb, workspaceStorageDir);
        const projectWorkspace = findQoderWorkspaceGroups(workspaces, '/Users/example/workspace/project-a')[0];

        expect(workspaces).toHaveLength(2);
        expect(projectWorkspace).toMatchObject({
            fileOperationCount: 2,
            label: 'project-a',
            messageCount: 2,
            renderablePartCount: 4,
            sessionCount: 1,
            snapshotFileCount: 1,
            userMessageCount: 2,
            worktree: '/Users/example/workspace/project-a',
        });

        const sessions = await listQoderSessionsForGroup(
            projectWorkspace?.key ?? '',
            globalStateDb,
            workspaceStorageDir,
        );
        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            agentClass: 'QuestAgent',
            executionMode: 'agent',
            fileOperationCount: 2,
            historyIds: ['history-1', 'history-2'],
            requestId: 'request-a',
            sessionId: 'task-a.session.execution',
            status: 'Completed',
            taskId: 'task-a',
            title: 'Wizard Step 9 Split',
        });

        const transcript = await readQoderSessionTranscript(
            globalStateDb,
            workspaceStorageDir,
            'task-a.session.execution',
        );
        expect(transcript?.session.fileOperationCount).toBe(2);
        expect(transcript?.entries.map((entry) => entry.entryType)).toEqual([
            'message',
            'message',
            'tool_call',
            'tool_call',
        ]);
        expect(transcript?.entries[0]?.parts[0]?.text).toContain('First read AGENTS.md.');
        expect(transcript?.entries[2]?.parts[0]?.text).toContain(
            'Create file: /Users/example/workspace/project-a/src/index.ts',
        );
        expect(transcript?.entries[3]?.parts[0]?.text).toContain('Edit file:');
        expect(transcript?.rawSession.task).toMatchObject({ id: 'task-a' });
    });

    it('should return empty results when Qoder data is missing', async () => {
        const tempRoot = await makeTempRoot();
        const missingDb = path.join(tempRoot, 'missing.vscdb');
        const missingStorage = path.join(tempRoot, 'workspaceStorage');

        expect(await listQoderWorkspaceGroups(missingDb, missingStorage)).toEqual([]);
        expect(await listQoderSessionsForGroup('workspace:missing', missingDb, missingStorage)).toEqual([]);
        expect(await readQoderSessionTranscript(missingDb, missingStorage, 'missing')).toBeNull();
    });
});
