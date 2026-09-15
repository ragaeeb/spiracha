import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deleteQoderConversation, isQoderRunning, planQoderDeletion } from './qoder-mutations';
import { parseTaskSnapshotRows, QODER_TASK_SNAPSHOT_KEY, readQoderItemTableRows } from './qoder-storage';

const tempRoots: string[] = [];
const stoppedWriter = { isWriterRunning: async () => false };

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'qoder-mutations-'));
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

const readItemTable = async (dbPath: string): Promise<Record<string, unknown>> => {
    const rows = await readQoderItemTableRows(dbPath);
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value) as unknown]));
};

const historyKey = (workspaceStorageId: string) => `lingma.chat.localHistory.${workspaceStorageId}.quest`;

const sharedTaskEntries = (project: string) => ({
    [QODER_TASK_SNAPSHOT_KEY]: {
        folders: {
            [project]: {
                tasks: [
                    {
                        designSessionId: 'design-1',
                        executionSessionId: 'task-shared.session.execution',
                        id: 'task-shared',
                        title: 'Shared quest',
                        workspaceUri: `file://${project}`,
                    },
                ],
                updatedAt: 1,
            },
            [`${project}-other`]: {
                tasks: [
                    {
                        executionSessionId: 'task-other.session.execution',
                        id: 'task-other',
                        title: 'Other quest',
                        workspaceUri: `file://${project}-other`,
                    },
                ],
                updatedAt: 1,
            },
        },
        updatedAt: 1,
        version: 1,
    },
    [historyKey('ws-a')]: [
        {
            extra: 'keep-me',
            id: 'history-exec',
            sessionId: 'task-shared.session.execution',
            timestamp: 1_780_439_242_392,
            title: 'Execution turn',
        },
        {
            extra: 'sibling',
            id: 'history-design',
            sessionId: 'design-1',
            timestamp: 1_780_439_243_392,
            title: 'Design turn',
        },
        {
            extra: 'other-session',
            id: 'history-other',
            sessionId: 'task-other.session.execution',
            timestamp: 1_780_439_244_392,
            title: 'Other project turn',
        },
    ],
});

const makeLocations = async (tempRoot: string, entries: Record<string, unknown>) => {
    const project = path.join(tempRoot, 'project-a');
    const globalStateDb = path.join(tempRoot, 'globalStorage', 'state.vscdb');
    const workspaceStorageDir = path.join(tempRoot, 'workspaceStorage');
    const cliProjectsDir = path.join(tempRoot, 'cli', 'projects');
    const sentinel = path.join(project, 'src', 'index.ts');
    await mkdir(path.dirname(sentinel), { recursive: true });
    await mkdir(workspaceStorageDir, { recursive: true });
    await mkdir(cliProjectsDir, { recursive: true });
    await Bun.write(sentinel, 'export const value = 1;\n');
    await writeGlobalStateDb(globalStateDb, entries);
    return {
        cliProjectsDir,
        globalStateDb,
        project,
        sentinel,
        sentinelBytes: await Bun.file(sentinel).bytes(),
        workspaceStorageDir,
    };
};

const writeStateFile = async (workspaceStorageDir: string, sessionId: string) => {
    const statePath = path.join(workspaceStorageDir, 'ws-a', 'chatEditingSessions', sessionId, 'state.json');
    await mkdir(path.dirname(statePath), { recursive: true });
    await Bun.write(statePath, JSON.stringify({ sessionId, version: 2 }));
    return statePath;
};

describe('qoder deletion planner', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should remove only selected history records and keep sibling sessions and tasks', async () => {
        const tempRoot = await makeTempRoot();
        const locations = await makeLocations(tempRoot, sharedTaskEntries(path.join(tempRoot, 'project-a')));
        const statePath = await writeStateFile(locations.workspaceStorageDir, 'design-1');
        const cliPath = path.join(locations.cliProjectsDir, 'design-1.jsonl');
        await Bun.write(cliPath, '{"id":"cli"}\n');

        const plan = await planQoderDeletion(locations, 'design-1');

        expect(plan?.canonicalSessionId).toBe('design-1');
        expect(plan?.historyRemovals).toEqual([
            {
                key: historyKey('ws-a'),
                preservedIds: ['history-exec', 'history-other'],
                removedIds: ['history-design'],
            },
        ]);
        expect(plan?.taskPlan).toEqual([
            {
                action: 'clear_fields',
                clearedFields: ['designSessionId'],
                folder: locations.project,
                taskId: 'task-shared',
            },
        ]);
        expect(plan?.preservedTaskIds).toEqual(['task-shared', 'task-other']);
        expect(plan?.ownedFiles.map((file) => file.path).sort()).toEqual([cliPath, statePath].sort());
        expect(plan?.affectedSessionIds).not.toContain('task-shared.session.execution');
    });

    it('should refuse deleting an execution session while an independent design session remains', async () => {
        const tempRoot = await makeTempRoot();
        const locations = await makeLocations(tempRoot, sharedTaskEntries(path.join(tempRoot, 'project-a')));

        await expect(planQoderDeletion(locations, 'task-shared.session.execution')).rejects.toMatchObject({
            reasonCode: 'ownership_conflict',
        });
        await expect(planQoderDeletion(locations, 'task-shared')).rejects.toMatchObject({
            reasonCode: 'ownership_conflict',
        });
    });

    it('should resolve a unique task alias without suffix matching a sibling id', async () => {
        const tempRoot = await makeTempRoot();
        const project = path.join(tempRoot, 'project-a');
        const locations = await makeLocations(tempRoot, {
            [QODER_TASK_SNAPSHOT_KEY]: {
                folders: {
                    [project]: {
                        tasks: [
                            {
                                executionSessionId: 'task-a.session.execution',
                                id: 'task-a',
                                title: 'Only session',
                            },
                        ],
                    },
                },
            },
            [historyKey('ws-a')]: [
                { id: 'history-1', sessionId: 'task-a.session.execution', title: 'Keep sibling out' },
                { id: 'history-suffix', sessionId: 'task-a.session.execution-extra', title: 'Not a match' },
            ],
        });

        const plan = await planQoderDeletion(locations, 'task-a');
        expect(plan?.canonicalSessionId).toBe('task-a.session.execution');
        expect(plan?.historyRemovals[0]?.removedIds).toEqual(['history-1']);
        expect(plan?.historyRemovals[0]?.preservedIds).toEqual(['history-suffix']);
        expect(plan?.taskPlan).toEqual([{ action: 'remove_task', folder: project, taskId: 'task-a' }]);
    });

    it('should fail closed on malformed shared JSON before any caller can write', async () => {
        const tempRoot = await makeTempRoot();
        const globalStateDb = path.join(tempRoot, 'globalStorage', 'state.vscdb');
        await mkdir(path.dirname(globalStateDb), { recursive: true });
        const db = new Database(globalStateDb, { create: true, strict: true });
        db.run('create table ItemTable (key text primary key, value text)');
        db.run('insert into ItemTable (key, value) values (?, ?)', [historyKey('ws-a'), '{"not":"an-array"}']);
        db.close();

        await expect(
            planQoderDeletion(
                {
                    cliProjectsDir: path.join(tempRoot, 'cli'),
                    globalStateDb,
                    workspaceStorageDir: path.join(tempRoot, 'workspaceStorage'),
                },
                'task-a.session.execution',
            ),
        ).rejects.toMatchObject({ reasonCode: 'malformed_store' });
        expect(await Bun.file(globalStateDb).text()).toContain('not');
    });
});

describe('qoder deletion apply', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should delete a uniquely owned session, preserve siblings, and leave the worktree sentinel intact', async () => {
        const tempRoot = await makeTempRoot();
        const locations = await makeLocations(tempRoot, sharedTaskEntries(path.join(tempRoot, 'project-a')));
        const statePath = await writeStateFile(locations.workspaceStorageDir, 'design-1');
        const otherState = await writeStateFile(locations.workspaceStorageDir, 'task-shared.session.execution');
        const cliPath = path.join(locations.cliProjectsDir, 'design-1.jsonl');
        await Bun.write(cliPath, '{"id":"cli"}\n');

        const result = await deleteQoderConversation('design-1', locations, stoppedWriter);

        expect(result.deletedIds).toEqual(['design-1']);
        expect(result.deletedFiles.sort()).toEqual([cliPath, statePath].sort());
        expect(await Bun.file(statePath).exists()).toBe(false);
        expect(await Bun.file(cliPath).exists()).toBe(false);
        expect(await Bun.file(otherState).exists()).toBe(true);
        expect(await Bun.file(locations.sentinel).bytes()).toEqual(locations.sentinelBytes);

        const table = await readItemTable(locations.globalStateDb);
        const history = table[historyKey('ws-a')] as Array<Record<string, unknown>>;
        expect(history.map((item) => item.id)).toEqual(['history-exec', 'history-other']);
        expect(history[0]).toMatchObject({ extra: 'keep-me', sessionId: 'task-shared.session.execution' });
        const tasks = parseTaskSnapshotRows(
            Object.entries(table).map(([key, value]) => ({ key, value: JSON.stringify(value) })),
        );
        expect(tasks.find((task) => task.id === 'task-shared')?.sessionIds).toContain('task-shared.session.execution');
        expect(tasks.find((task) => task.id === 'task-shared')?.sessionIds).not.toContain('design-1');
        expect(tasks.some((task) => task.id === 'task-other')).toBe(true);
    });

    it('should return missing without creating a replacement database', async () => {
        const tempRoot = await makeTempRoot();
        const globalStateDb = path.join(tempRoot, 'globalStorage', 'state.vscdb');
        await mkdir(path.dirname(globalStateDb), { recursive: true });

        const result = await deleteQoderConversation(
            'task-a.session.execution',
            {
                cliProjectsDir: path.join(tempRoot, 'cli'),
                globalStateDb,
                workspaceStorageDir: path.join(tempRoot, 'workspaceStorage'),
            },
            stoppedWriter,
        );

        expect(result).toEqual({ deletedFiles: [], deletedIds: [] });
        expect(await Bun.file(globalStateDb).exists()).toBe(false);
    });

    it('should reject concurrent ItemTable changes after the durable plan is written', async () => {
        const tempRoot = await makeTempRoot();
        const locations = await makeLocations(tempRoot, sharedTaskEntries(path.join(tempRoot, 'project-a')));
        const original = await readItemTable(locations.globalStateDb);

        await expect(
            deleteQoderConversation('design-1', locations, {
                ...stoppedWriter,
                afterIntent: async () => {
                    const db = new Database(locations.globalStateDb, { readwrite: true, strict: true });
                    db.run('update ItemTable set value = ? where key = ?', [
                        JSON.stringify([{ id: 'changed', sessionId: 'design-1' }]),
                        historyKey('ws-a'),
                    ]);
                    db.close();
                },
            }),
        ).rejects.toMatchObject({ reasonCode: 'concurrent_modification' });

        expect(await readItemTable(locations.globalStateDb)).toEqual({
            ...original,
            [historyKey('ws-a')]: [{ id: 'changed', sessionId: 'design-1' }],
        });
    });

    it('should keep a durable receipt when file cleanup fails after logical commit', async () => {
        const tempRoot = await makeTempRoot();
        const locations = await makeLocations(tempRoot, sharedTaskEntries(path.join(tempRoot, 'project-a')));
        const statePath = await writeStateFile(locations.workspaceStorageDir, 'design-1');

        const first = await deleteQoderConversation('design-1', locations, {
            ...stoppedWriter,
            unlinkFile: async () => {
                throw new Error('injected unlink failure');
            },
        });

        expect(first.deletedIds).toEqual(['design-1']);
        expect(first.receiptId).toMatch(/^\.spiracha-qoder-delete-[0-9a-f]{16}\.json$/u);
        expect(first.cleanupFailures?.[0]).toMatchObject({ path: statePath, phase: 'file-cleanup' });
        expect(await Bun.file(statePath).exists()).toBe(true);
        const table = await readItemTable(locations.globalStateDb);
        const history = table[historyKey('ws-a')] as Array<Record<string, unknown>>;
        expect(history.map((item) => item.id)).not.toContain('history-design');

        const retry = await deleteQoderConversation('design-1', locations, stoppedWriter);
        expect(retry.deletedIds).toEqual(['design-1']);
        expect(retry.cleanupFailures).toBeUndefined();
        expect(await Bun.file(statePath).exists()).toBe(false);
        expect(await Bun.file(locations.sentinel).bytes()).toEqual(locations.sentinelBytes);
    });

    it('should finish exact file cleanup after history rows disappear', async () => {
        const tempRoot = await makeTempRoot();
        const locations = await makeLocations(tempRoot, sharedTaskEntries(path.join(tempRoot, 'project-a')));
        const statePath = await writeStateFile(locations.workspaceStorageDir, 'design-1');

        await deleteQoderConversation('design-1', locations, {
            ...stoppedWriter,
            unlinkFile: async () => {
                throw new Error('injected unlink failure');
            },
        });
        const db = new Database(locations.globalStateDb, { readwrite: true, strict: true });
        db.run('update ItemTable set value = ? where key = ?', ['[]', historyKey('ws-a')]);
        db.close();

        const retry = await deleteQoderConversation('design-1', locations, stoppedWriter);
        expect(retry.deletedIds).toEqual(['design-1']);
        expect(await Bun.file(statePath).exists()).toBe(false);
    });

    it('should refuse deletion while Qoder is running', async () => {
        const tempRoot = await makeTempRoot();
        const locations = await makeLocations(tempRoot, sharedTaskEntries(path.join(tempRoot, 'project-a')));

        await expect(
            deleteQoderConversation('design-1', locations, { isWriterRunning: async () => true }),
        ).rejects.toMatchObject({ reasonCode: 'writer_running' });
        expect(((await readItemTable(locations.globalStateDb))[historyKey('ws-a')] as unknown[]).length).toBe(3);
    });

    it('should classify only pgrep statuses zero and one as running and stopped', async () => {
        const processWithExitCode = (exitCode: number) => () => ({ exited: Promise.resolve(exitCode) });

        await expect(isQoderRunning(processWithExitCode(0))).resolves.toBe(true);
        await expect(isQoderRunning(processWithExitCode(1))).resolves.toBe(false);
        await expect(isQoderRunning(processWithExitCode(2))).rejects.toThrow(
            'Unable to verify whether Qoder is running: pgrep exited with status 2',
        );
    });
});
