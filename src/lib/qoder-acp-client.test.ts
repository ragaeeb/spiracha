import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { loadQoderAcpSession } from './qoder-acp-client';

const tempRoots: string[] = [];

type JsonRpcMessage = {
    id?: number;
    jsonrpc?: '2.0';
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
};

const makeTempRoot = async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'qoder-acp-test-'));
    tempRoots.push(tempRoot);
    return tempRoot;
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

describe('loadQoderAcpSession', () => {
    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    it('should collect Qoder session updates from a framed ACP socket', async () => {
        const tempRoot = await makeTempRoot();
        const socketPath = path.join(tempRoot, 'qoder.sock');
        const requests: JsonRpcMessage[] = [];
        const server = net.createServer((socket) => {
            let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
            socket.on('data', (chunk) => {
                const parsed = parseMessages(appendSocketChunk(buffer, chunk));
                buffer = parsed.rest;
                for (const message of parsed.messages) {
                    requests.push(message);
                    if (message.method === 'initialize') {
                        socket.write(encodeMessage({ id: message.id, jsonrpc: '2.0', result: { capabilities: {} } }));
                    }
                    if (message.method === 'session/load') {
                        socket.write(encodeMessage({ id: message.id, jsonrpc: '2.0', result: null }));
                        setTimeout(() => {
                            socket.write(
                                encodeMessage({
                                    jsonrpc: '2.0',
                                    method: 'session/update',
                                    params: {
                                        _meta: { 'ai-coding/request-id': 'request-a' },
                                        sessionId: 'task-a.session.execution',
                                        update: {
                                            content: { text: 'Hello' },
                                            sessionUpdate: 'user_message_chunk',
                                        },
                                    },
                                }),
                            );
                            socket.write(
                                encodeMessage({
                                    jsonrpc: '2.0',
                                    method: 'session/update',
                                    params: {
                                        sessionId: 'task-a.session.execution',
                                        update: {
                                            content: { text: 'Hello! How can I help?' },
                                            sessionUpdate: 'agent_message_chunk',
                                        },
                                    },
                                }),
                            );
                            socket.write(
                                encodeMessage({
                                    jsonrpc: '2.0',
                                    method: 'session/update',
                                    params: {
                                        sessionId: 'task-a.session.execution',
                                        update: {
                                            modelId: 'qmodel_latest',
                                            sessionUpdate: 'current_model_update',
                                        },
                                    },
                                }),
                            );
                        }, 10);
                    }
                }
            });
        });
        await listen(server, socketPath);

        const result = await loadQoderAcpSession({
            cwd: '/workspace/project',
            drainMs: 75,
            sessionId: 'task-a.session.execution',
            socketPath,
            taskId: 'task-a',
            timeoutMs: 500,
        });
        server.close();

        expect(requests.map((request) => request.method)).toEqual(['initialize', 'session/load']);
        expect(requests[1]?.params).toMatchObject({
            _meta: {
                'ai-coding/load-request-limit': 50,
                'ai-coding/quest-task-id': 'task-a',
            },
            cwd: '/workspace/project',
            sessionId: 'task-a.session.execution',
        });
        expect(result?.events).toEqual([
            expect.objectContaining({
                requestId: 'request-a',
                sessionId: 'task-a.session.execution',
                update: expect.objectContaining({ sessionUpdate: 'user_message_chunk' }),
            }),
            expect.objectContaining({
                sessionId: 'task-a.session.execution',
                update: expect.objectContaining({ sessionUpdate: 'agent_message_chunk' }),
            }),
            expect.objectContaining({
                sessionId: 'task-a.session.execution',
                update: expect.objectContaining({ modelId: 'qmodel_latest' }),
            }),
        ]);
    });

    it('should keep draining while Qoder session updates are still arriving', async () => {
        const tempRoot = await makeTempRoot();
        const socketPath = path.join(tempRoot, 'qoder.sock');
        const server = net.createServer((socket) => {
            let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
            socket.on('data', (chunk) => {
                const parsed = parseMessages(appendSocketChunk(buffer, chunk));
                buffer = parsed.rest;
                for (const message of parsed.messages) {
                    if (message.method === 'initialize') {
                        socket.write(encodeMessage({ id: message.id, jsonrpc: '2.0', result: { capabilities: {} } }));
                    }
                    if (message.method === 'session/load') {
                        socket.write(encodeMessage({ id: message.id, jsonrpc: '2.0', result: null }));
                        setTimeout(() => {
                            socket.write(
                                encodeMessage({
                                    jsonrpc: '2.0',
                                    method: 'session/update',
                                    params: {
                                        sessionId: 'task-a.session.execution',
                                        update: {
                                            content: { text: 'Inspecting the implementation.' },
                                            sessionUpdate: 'agent_thought_chunk',
                                        },
                                    },
                                }),
                            );
                        }, 30);
                        setTimeout(() => {
                            socket.write(
                                encodeMessage({
                                    jsonrpc: '2.0',
                                    method: 'session/update',
                                    params: {
                                        sessionId: 'task-a.session.execution',
                                        update: {
                                            content: { text: 'Final review answer.' },
                                            sessionUpdate: 'agent_message_chunk',
                                        },
                                    },
                                }),
                            );
                        }, 80);
                    }
                }
            });
        });
        await listen(server, socketPath);

        const result = await loadQoderAcpSession({
            cwd: '/workspace/project',
            drainMs: 60,
            sessionId: 'task-a.session.execution',
            socketPath,
            timeoutMs: 500,
        });
        server.close();

        expect(result?.events.map((event) => event.update)).toEqual([
            expect.objectContaining({ sessionUpdate: 'agent_thought_chunk' }),
            expect.objectContaining({ sessionUpdate: 'agent_message_chunk' }),
        ]);
    });
});
