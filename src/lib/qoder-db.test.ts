import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
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

type JsonRpcMessage = {
    id?: number;
    jsonrpc?: '2.0';
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
};

const encodeMessage = (message: JsonRpcMessage): string => {
    const body = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
};

const appendSocketChunk = (
    buffer: Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike> | string,
): Buffer<ArrayBufferLike> => {
    return Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
};

const parseMessages = (
    buffer: Buffer<ArrayBufferLike>,
): { messages: JsonRpcMessage[]; rest: Buffer<ArrayBufferLike> } => {
    const messages: JsonRpcMessage[] = [];
    let rest = buffer;

    while (true) {
        const headerEnd = rest.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
            return { messages, rest };
        }

        const header = rest.subarray(0, headerEnd).toString('utf8');
        const contentLength = Number(/Content-Length:\s*(\d+)/iu.exec(header)?.[1] ?? 0);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (rest.length < bodyEnd) {
            return { messages, rest };
        }

        messages.push(JSON.parse(rest.subarray(bodyStart, bodyEnd).toString('utf8')) as JsonRpcMessage);
        rest = rest.subarray(bodyEnd);
    }
};

const listen = async (server: net.Server, socketPath: string) => {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
            server.off('error', reject);
            resolve();
        });
    });
};

const writeAcpUpdate = (socket: net.Socket, update: Record<string, unknown>) => {
    socket.write(
        encodeMessage({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
                _meta: { 'ai-coding/request-id': 'request-live' },
                sessionId: 'task-live.session.execution',
                update,
            },
        }),
    );
};

const handleAcpRequest = (socket: net.Socket, message: JsonRpcMessage, updates: Record<string, unknown>[]) => {
    if (message.method === 'initialize') {
        socket.write(encodeMessage({ id: message.id, jsonrpc: '2.0', result: { capabilities: {} } }));
    }
    if (message.method === 'session/load') {
        socket.write(encodeMessage({ id: message.id, jsonrpc: '2.0', result: null }));
        for (const update of updates) {
            writeAcpUpdate(socket, update);
        }
    }
};

const startQoderAcpServer = async (socketPath: string, updates: Record<string, unknown>[]): Promise<net.Server> => {
    const server = net.createServer((socket) => {
        let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        socket.on('data', (chunk) => {
            const parsed = parseMessages(appendSocketChunk(buffer, chunk));
            buffer = parsed.rest;
            for (const message of parsed.messages) {
                handleAcpRequest(socket, message, updates);
            }
        });
    });
    await listen(server, socketPath);
    return server;
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
                                model: 'qwen-3.7-max',
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
            model: 'qwen-3.7-max',
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
        expect(transcript?.entries[0]?.parts[0]?.text).toContain(
            'First read AGENTS.md.\n/Users/example/workspace/project-a/src/index.ts',
        );
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

    it('should merge Qoder CLI JSONL messages with local history and checkpoint operations', async () => {
        const tempRoot = await makeTempRoot();
        const globalStateDb = path.join(tempRoot, 'globalStorage', 'state.vscdb');
        const workspaceStorageDir = path.join(tempRoot, 'workspaceStorage');
        const cliProjectsDir = path.join(tempRoot, 'SharedClientCache', 'cli', 'projects');
        await writeGlobalStateDb(globalStateDb, {
            'aicoding.questTaskListSnapshot': {
                folders: {
                    '/Users/example/workspace/project-a': {
                        tasks: [
                            {
                                executionSessionExtra: JSON.stringify({
                                    questTaskInfo: { modelId: 'qmodel_latest' },
                                }),
                                executionSessionId: 'task-a.session.execution',
                                id: 'task-a',
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
                    title: 'Review this implementation.\n/Users/example/workspace/project-a/src/index.ts',
                },
            ],
        });
        await writeQoderState(workspaceStorageDir);
        await mkdir(cliProjectsDir, { recursive: true });
        await Bun.write(
            path.join(cliProjectsDir, 'task-a.session.execution.jsonl'),
            [
                {
                    id: 'assistant-1',
                    parts: [{ data: { thinking: 'Inspecting the code path.' }, type: 'reasoning' }],
                    role: 'assistant',
                    session_id: 'task-a.session.execution',
                    timestamp: '2026-06-01T10:00:01.000Z',
                },
                {
                    id: 'assistant-2',
                    parts: [
                        {
                            data: { id: 'call-1', input: '{"file_path":"/tmp/file.ts"}', name: 'Read' },
                            type: 'tool_call',
                        },
                    ],
                    role: 'assistant',
                    session_id: 'task-a.session.execution',
                    timestamp: '2026-06-01T10:00:02.000Z',
                },
                {
                    id: 'tool-1',
                    parts: [
                        {
                            data: { content: 'const value = 1;', name: 'Read', tool_use_id: 'call-1' },
                            type: 'tool_result',
                        },
                    ],
                    role: 'tool',
                    session_id: 'task-a.session.execution',
                    timestamp: '2026-06-01T10:00:03.000Z',
                },
                {
                    id: 'assistant-3',
                    parts: [
                        {
                            data: { text: 'Final answer: race on shared mutable state.' },
                            type: 'text',
                        },
                    ],
                    role: 'assistant',
                    session_id: 'task-a.session.execution',
                    timestamp: '2026-06-01T10:00:04.000Z',
                },
            ]
                .map((line) => JSON.stringify(line))
                .join('\n'),
        );

        const transcript = await readQoderSessionTranscript(
            globalStateDb,
            workspaceStorageDir,
            'task-a.session.execution',
            cliProjectsDir,
        );

        expect(transcript?.entries.map((entry) => entry.entryType)).toEqual([
            'message',
            'message',
            'tool_call',
            'tool_output',
            'message',
            'tool_call',
            'tool_call',
        ]);
        expect(transcript?.session).toMatchObject({
            assistantMessageCount: 2,
            messageCount: 3,
            model: 'Qwen 3.7 Max',
            renderablePartCount: 7,
            userMessageCount: 1,
        });
        expect(transcript?.entries[1]?.parts[0]?.text).toBe('Inspecting the code path.');
        expect(transcript?.entries[2]?.parts[0]?.text).toContain('Read\n{"file_path":"/tmp/file.ts"}');
        expect(transcript?.entries[3]?.parts[0]?.text).toBe('const value = 1;');
        expect(transcript?.entries[4]?.parts[0]?.text).toBe('Final answer: race on shared mutable state.');
        expect(transcript?.rawSession.sourceCliTranscriptPath).toContain('task-a.session.execution.jsonl');
    });

    it('should use the persisted default Qoder model for auto CLI transcripts without task metadata', async () => {
        const tempRoot = await makeTempRoot();
        const globalStateDb = path.join(tempRoot, 'globalStorage', 'state.vscdb');
        const workspaceStorageDir = path.join(tempRoot, 'workspaceStorage');
        const cliProjectsDir = path.join(tempRoot, 'SharedClientCache', 'cli', 'projects');
        await writeGlobalStateDb(globalStateDb, {
            'aicoding.modelConfigs.cache.quest': [{ enabled: true, isDefault: true, name: 'qmodel_latest' }],
            'lingma.chat.localHistory.ws-a.quest': [
                {
                    id: 'history-1',
                    sessionId: 'task-auto.session.execution',
                    timestamp: 1_780_439_242_392,
                    title: 'Review\n/Users/example/workspace/project-a/src/index.ts',
                },
            ],
        });
        await mkdir(cliProjectsDir, { recursive: true });
        await Bun.write(
            path.join(cliProjectsDir, 'task-auto.session.execution.jsonl'),
            JSON.stringify({
                id: 'assistant-1',
                model: 'auto',
                parts: [{ data: { text: 'Final answer: race on shared mutable state.' }, type: 'text' }],
                provider: 'qoder',
                role: 'assistant',
                timestamp: '2026-06-01T10:00:04.000Z',
            }),
        );

        const transcript = await readQoderSessionTranscript(
            globalStateDb,
            workspaceStorageDir,
            'task-auto.session.execution',
            cliProjectsDir,
        );

        expect(transcript?.session.model).toBe('Qwen 3.7 Max');
        expect(transcript?.entries.map((entry) => entry.role)).toEqual(['user', 'assistant']);
        expect(transcript?.entries[1]?.parts[0]?.text).toContain('race on shared mutable state');
    });

    it('should hydrate recent Qoder sessions from ACP when no CLI transcript exists', async () => {
        const tempRoot = await makeTempRoot();
        const globalStateDb = path.join(tempRoot, 'globalStorage', 'state.vscdb');
        const workspaceStorageDir = path.join(tempRoot, 'workspaceStorage');
        const cliProjectsDir = path.join(tempRoot, 'SharedClientCache', 'cli', 'projects');
        const socketPath = path.join(tempRoot, 'qoder.sock');
        await writeGlobalStateDb(globalStateDb, {
            'aicoding.questTaskListSnapshot': {
                folders: {
                    '/Users/example/workspace/project-a': {
                        tasks: [
                            {
                                executionSessionId: 'task-live.session.execution',
                                id: 'task-live',
                                status: 'Completed',
                                title: 'Hello',
                                updatedAtTimestamp: Date.now(),
                                workspaceUri: 'file:///Users/example/workspace/project-a',
                            },
                        ],
                    },
                },
            },
            'lingma.chat.localHistory.ws-a.quest': [
                {
                    id: 'history-1',
                    sessionId: 'task-live.session.execution',
                    timestamp: Date.now(),
                    title: 'Hello',
                },
            ],
        });
        await mkdir(cliProjectsDir, { recursive: true });
        const server = await startQoderAcpServer(socketPath, [
            { content: { text: 'Hello' }, sessionUpdate: 'user_message_chunk' },
            {
                content: { text: 'The user is greeting me. Let me respond with a friendly greeting.' },
                sessionUpdate: 'agent_thought_chunk',
            },
            {
                content: { text: 'Hello! How can I help you today?' },
                sessionUpdate: 'agent_message_chunk',
            },
            { modelId: 'qmodel_latest', sessionUpdate: 'current_model_update' },
        ]);

        const transcript = await readQoderSessionTranscript(
            globalStateDb,
            workspaceStorageDir,
            'task-live.session.execution',
            cliProjectsDir,
            {
                acpDrainMs: 50,
                acpSocketPath: socketPath,
                acpTimeoutMs: 500,
                enableAcp: true,
            },
        );
        server.close();

        expect(transcript?.session).toMatchObject({
            assistantMessageCount: 2,
            messageCount: 3,
            model: 'Qwen 3.7 Max',
            userMessageCount: 1,
        });
        expect(transcript?.entries.map((entry) => entry.role)).toEqual(['user', 'assistant', 'assistant']);
        expect(transcript?.entries[1]?.parts[0]?.text).toContain('The user is greeting me');
        expect(transcript?.entries[2]?.parts[0]?.text).toBe('Hello! How can I help you today?');
        expect(transcript?.rawSession.sourceAcpSocketPath).toBe(socketPath);
    });
});
