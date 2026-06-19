import net from 'node:net';
import path from 'node:path';
import { resolveQoderUserDir } from './qoder-exporter-types';
import { asObject, asString, type JsonValue } from './shared';

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_DRAIN_MS = 300;
const INITIALIZE_REQUEST_ID = 1;
const LOAD_REQUEST_ID = 2;

type JsonRpcMessage = {
    id?: number;
    jsonrpc?: '2.0';
    method?: string;
    params?: Record<string, JsonValue>;
    result?: JsonValue;
};

export type QoderAcpSessionUpdate = {
    requestId: string | null;
    sessionId: string;
    update: Record<string, JsonValue>;
};

export type QoderAcpSessionLoadResult = {
    events: QoderAcpSessionUpdate[];
    socketPath: string;
};

export type QoderAcpSessionLoadOptions = {
    cwd: string;
    drainMs?: number;
    requestLimit?: number;
    sessionId: string;
    socketPath?: string;
    taskId?: string | null;
    timeoutMs?: number;
};

export const resolveQoderAcpSocketPath = (): string => {
    const configured = process.env.SPIRACHA_QODER_SOCKET_PATH?.trim() || process.env.SPIRACHA_QODER_SOCKET?.trim();
    return configured ? configured : path.join(path.dirname(resolveQoderUserDir()), 'SharedClientCache', 'qoder.sock');
};

const encodeJsonRpcMessage = (message: JsonRpcMessage): string => {
    const body = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
};

const appendSocketChunk = (
    buffer: Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike> | string,
): Buffer<ArrayBufferLike> => {
    return Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
};

const parseJsonRpcMessages = (
    buffer: Buffer<ArrayBufferLike>,
): {
    messages: JsonRpcMessage[];
    rest: Buffer<ArrayBufferLike>;
} => {
    const messages: JsonRpcMessage[] = [];
    let rest = buffer;

    while (true) {
        const headerEnd = rest.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
            return { messages, rest };
        }

        const header = rest.subarray(0, headerEnd).toString('utf8');
        const lengthMatch = /Content-Length:\s*(\d+)/iu.exec(header);
        if (!lengthMatch) {
            return { messages, rest: Buffer.alloc(0) };
        }

        const contentLength = Number(lengthMatch[1]);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (rest.length < bodyEnd) {
            return { messages, rest };
        }

        try {
            messages.push(JSON.parse(rest.subarray(bodyStart, bodyEnd).toString('utf8')) as JsonRpcMessage);
        } catch {}

        rest = rest.subarray(bodyEnd);
    }
};

const getRequestId = (params: Record<string, JsonValue> | null): string | null => {
    const meta = asObject(params?._meta ?? null);
    return asString(meta?.['ai-coding/request-id'] ?? null);
};

const getSessionUpdate = (message: JsonRpcMessage): QoderAcpSessionUpdate | null => {
    if (message.method !== 'session/update') {
        return null;
    }

    const params = asObject(message.params ?? null);
    const sessionId = asString(params?.sessionId ?? null);
    const update = asObject(params?.update ?? null);
    if (!sessionId || !update) {
        return null;
    }

    return {
        requestId: getRequestId(params),
        sessionId,
        update,
    };
};

export const loadQoderAcpSession = async (
    options: QoderAcpSessionLoadOptions,
): Promise<QoderAcpSessionLoadResult | null> => {
    const socketPath = options.socketPath ?? resolveQoderAcpSocketPath();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const drainMs = options.drainMs ?? DEFAULT_DRAIN_MS;
    const requestLimit = options.requestLimit ?? 50;

    return await new Promise<QoderAcpSessionLoadResult | null>((resolve) => {
        const socket = net.createConnection(socketPath);
        const events: QoderAcpSessionUpdate[] = [];
        let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let resolved = false;
        let loadCompleted = false;
        let drainTimer: ReturnType<typeof setTimeout> | null = null;
        let timeout: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (drainTimer) {
                clearTimeout(drainTimer);
            }
            if (timeout) {
                clearTimeout(timeout);
            }
            socket.destroy();
        };

        const finish = (result: QoderAcpSessionLoadResult | null) => {
            if (resolved) {
                return;
            }

            resolved = true;
            cleanup();
            resolve(result);
        };

        timeout = setTimeout(() => {
            finish(events.length > 0 ? { events, socketPath } : null);
        }, timeoutMs);

        const write = (message: JsonRpcMessage) => {
            socket.write(encodeJsonRpcMessage(message));
        };

        const sendLoadRequest = () => {
            write({
                id: LOAD_REQUEST_ID,
                jsonrpc: '2.0',
                method: 'session/load',
                params: {
                    _meta: {
                        'ai-coding/load-request-limit': requestLimit,
                        ...(options.taskId ? { 'ai-coding/quest-task-id': options.taskId } : {}),
                    },
                    cwd: options.cwd,
                    mcpServers: [],
                    sessionId: options.sessionId,
                    timestamp: Date.now(),
                },
            });
        };

        const scheduleDrain = () => {
            if (drainTimer) {
                clearTimeout(drainTimer);
            }

            drainTimer = setTimeout(() => {
                finish(events.length > 0 ? { events, socketPath } : null);
            }, drainMs);
        };

        const recordMatchingUpdate = (message: JsonRpcMessage) => {
            const update = getSessionUpdate(message);
            if (update?.sessionId !== options.sessionId) {
                return false;
            }

            if (events.length < requestLimit) {
                events.push(update);
            }
            if (loadCompleted) {
                scheduleDrain();
            }
            return true;
        };

        const markLoadCompleted = (message: JsonRpcMessage) => {
            if (message.id !== LOAD_REQUEST_ID || loadCompleted) {
                return false;
            }

            loadCompleted = true;
            scheduleDrain();
            return true;
        };

        const handleMessage = (message: JsonRpcMessage) => {
            if (message.id === INITIALIZE_REQUEST_ID) {
                sendLoadRequest();
                return;
            }

            if (recordMatchingUpdate(message)) {
                return;
            }

            markLoadCompleted(message);
        };

        socket.on('connect', () => {
            write({
                id: INITIALIZE_REQUEST_ID,
                jsonrpc: '2.0',
                method: 'initialize',
                params: {
                    clientCapabilities: {},
                    ideWindowType: 'quest',
                    protocolVersion: 1,
                    timestamp: Date.now(),
                },
            });
        });

        socket.on('data', (chunk) => {
            try {
                const parsed = parseJsonRpcMessages(appendSocketChunk(buffer, chunk));
                buffer = parsed.rest;
                parsed.messages.forEach(handleMessage);
            } catch {
                finish(events.length > 0 ? { events, socketPath } : null);
            }
        });

        socket.on('error', () => {
            finish(null);
        });

        socket.on('close', () => {
            finish(events.length > 0 ? { events, socketPath } : null);
        });
    });
};
