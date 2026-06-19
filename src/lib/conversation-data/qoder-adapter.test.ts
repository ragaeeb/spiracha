import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listConversationsForPath } from '.';

const tempRoots: string[] = [];

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'qoder-adapter-test-'));
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

describe('qoder conversation adapter', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should expose multiline prompts and Qoder CLI transcript messages through the stable API', async () => {
        const tempRoot = await makeTempRoot();
        const project = path.join(tempRoot, 'project');
        const globalStateDb = path.join(tempRoot, 'globalStorage', 'state.vscdb');
        const workspaceStorageDir = path.join(tempRoot, 'workspaceStorage');
        const qoderCliProjectsDir = path.join(tempRoot, 'SharedClientCache', 'cli', 'projects');
        await mkdir(project, { recursive: true });
        await mkdir(qoderCliProjectsDir, { recursive: true });
        await writeGlobalStateDb(globalStateDb, {
            'aicoding.questTaskListSnapshot': {
                folders: {
                    [project]: {
                        tasks: [
                            {
                                executionSessionExtra: JSON.stringify({
                                    questTaskInfo: { modelId: 'qmodel_latest' },
                                }),
                                executionSessionId: 'task-a.session.execution',
                                id: 'task-a',
                                status: 'Completed',
                                title: 'Runtime Fingerprint Review',
                                updatedAtTimestamp: 1_780_439_245_000,
                                workspaceUri: `file://${project}`,
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
                    title: `Review this implementation.\\n${path.join(project, 'src/index.ts')}`,
                },
            ],
        });
        await Bun.write(
            path.join(qoderCliProjectsDir, 'task-a.session.execution.jsonl'),
            [
                {
                    id: 'assistant-1',
                    parts: [{ data: { thinking: 'Inspecting shared mutable state.' }, type: 'reasoning' }],
                    role: 'assistant',
                    timestamp: '2026-06-01T10:00:01.000Z',
                },
                {
                    id: 'assistant-2',
                    parts: [
                        {
                            data: { id: 'call-1', input: '{"file_path":"src/index.ts"}', name: 'Read' },
                            type: 'tool_call',
                        },
                    ],
                    role: 'assistant',
                    timestamp: '2026-06-01T10:00:02.000Z',
                },
                {
                    id: 'tool-1',
                    parts: [
                        {
                            data: { content: 'const shared = {};', name: 'Read', tool_use_id: 'call-1' },
                            type: 'tool_result',
                        },
                    ],
                    role: 'tool',
                    timestamp: '2026-06-01T10:00:03.000Z',
                },
                {
                    id: 'assistant-3',
                    parts: [{ data: { text: 'Final answer: race on shared mutable state.' }, type: 'text' }],
                    role: 'assistant',
                    timestamp: '2026-06-01T10:00:04.000Z',
                },
            ]
                .map((line) => JSON.stringify(line))
                .join('\n'),
        );

        const page = await listConversationsForPath({
            cwd: project,
            includeMessages: true,
            locations: {
                qoderCliProjectsDir,
                qoderGlobalStateDb: globalStateDb,
                qoderWorkspaceStorageDir: workspaceStorageDir,
            },
            messageSelector: 'all',
            sources: ['qoder'],
        });

        expect(page.data).toHaveLength(1);
        expect(page.data[0]?.metadata.model).toBe('Qwen 3.7 Max');
        expect(page.data[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'unknown',
                role: 'user',
                text: `Review this implementation.\n${path.join(project, 'src/index.ts')}`,
            }),
            expect.objectContaining({
                phase: 'commentary',
                role: 'assistant',
                text: 'Inspecting shared mutable state.',
            }),
            expect.objectContaining({
                phase: 'tool_call',
                role: 'tool',
                text: 'Read\n{"file_path":"src/index.ts"}',
            }),
            expect.objectContaining({
                phase: 'tool_output',
                role: 'tool',
                text: 'const shared = {};',
            }),
            expect.objectContaining({
                phase: 'final_answer',
                role: 'assistant',
                text: 'Final answer: race on shared mutable state.',
            }),
        ]);

        const collectPage = await listConversationsForPath({
            cwd: project,
            includeMessages: true,
            locations: {
                qoderCliProjectsDir,
                qoderGlobalStateDb: globalStateDb,
                qoderWorkspaceStorageDir: workspaceStorageDir,
            },
            sources: ['qoder'],
        });

        expect(collectPage.data[0]?.messages).toEqual([
            expect.objectContaining({
                phase: 'final_answer',
                role: 'assistant',
                text: 'Final answer: race on shared mutable state.',
            }),
        ]);
    });
});
