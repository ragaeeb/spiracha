import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConversationClient, SpirachaClientError } from './client';
import type { ConversationDetail } from './lib/conversation-data/types';

const conversation = {
    createdAtMs: 1,
    deepLinks: {
        native: 'codex://threads/thread-1',
        spiracha: 'spiracha://conversation/codex/thread-1',
        ui: '/threads/thread-1',
    },
    id: 'thread-1',
    matches: [],
    messageCount: 1,
    messages: [
        {
            createdAtMs: 2,
            id: 'message-1',
            metadata: {},
            order: 0,
            phase: 'final_answer',
            role: 'assistant',
            text: 'Collected review output.',
        },
    ],
    metadata: {},
    source: 'codex',
    title: 'Thread 1',
    updatedAtMs: 2,
    workspaceKey: 'folder:/repo',
    workspacePath: '/repo',
} satisfies ConversationDetail;

describe('conversation client', () => {
    it('should list conversations locally without a running HTTP server', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spiracha-client-local-'));
        try {
            const client = createConversationClient({
                locations: {
                    antigravityRoots: [path.join(tempRoot, 'antigravity')],
                    claudeCodeProjectsDir: path.join(tempRoot, 'claude'),
                    codexDbPath: path.join(tempRoot, 'missing-codex.sqlite'),
                    cursorUserDir: path.join(tempRoot, 'cursor'),
                    kiroWorkspaceSessionsDir: path.join(tempRoot, 'kiro'),
                    opencodeDbPath: path.join(tempRoot, 'missing-opencode.sqlite'),
                    qoderGlobalStateDb: path.join(tempRoot, 'missing-qoder.sqlite'),
                    qoderWorkspaceStorageDir: path.join(tempRoot, 'qoder-workspaces'),
                },
                mode: 'local',
            });

            await expect(
                client.listConversations({
                    cwd: path.join(tempRoot, 'repo'),
                    includeMessages: true,
                    messageSelector: 'last_final_answer',
                }),
            ).resolves.toEqual({
                data: [],
                meta: { hasNext: false, nextCursor: null },
            });
        } finally {
            await rm(tempRoot, { force: true, recursive: true });
        }
    });

    it('should call the HTTP API using stable query names and normalize pagination metadata', async () => {
        const requestedUrls: string[] = [];
        const server = Bun.serve({
            fetch(request) {
                const url = new URL(request.url);
                requestedUrls.push(url.toString());
                expect(url.pathname).toBe('/api/v1/conversations');
                expect(url.searchParams.get('cwd')).toBe('/repo');
                expect(url.searchParams.get('include_messages')).toBe('true');
                expect(url.searchParams.get('message_selector')).toBe('last_final_answer');
                expect(url.searchParams.get('source')).toBe('codex,qoder');
                expect(url.searchParams.get('updated_after_ms')).toBe('100');

                return Response.json({
                    data: [conversation],
                    meta: { hasNext: true, next_cursor: 'cursor-2' },
                });
            },
            port: 0,
        });

        try {
            const client = createConversationClient({
                baseUrl: `http://127.0.0.1:${server.port}`,
                mode: 'http',
            });

            await expect(
                client.listConversations({
                    cwd: '/repo',
                    includeMessages: true,
                    messageSelector: 'last_final_answer',
                    sources: ['codex', 'qoder'],
                    updatedAfterMs: 100,
                }),
            ).resolves.toEqual({
                data: [conversation],
                meta: { hasNext: true, nextCursor: 'cursor-2' },
            });
            expect(requestedUrls).toHaveLength(1);
        } finally {
            server.stop(true);
        }
    });

    it('should surface HTTP API failures with status and message', async () => {
        const server = Bun.serve({
            fetch() {
                return Response.json(
                    {
                        error: {
                            message: 'bad cwd',
                        },
                    },
                    { status: 400 },
                );
            },
            port: 0,
        });

        try {
            const client = createConversationClient({
                baseUrl: `http://127.0.0.1:${server.port}`,
                mode: 'http',
            });

            await expect(client.listConversations({ cwd: '/repo' })).rejects.toThrow(
                new SpirachaClientError('Spiracha API request failed (400): bad cwd', 400),
            );
        } finally {
            server.stop(true);
        }
    });

    it('should normalize invalid HTTP response bodies into client errors', async () => {
        const server = Bun.serve({
            fetch() {
                return new Response('not json', {
                    headers: { 'Content-Type': 'application/json' },
                });
            },
            port: 0,
        });

        try {
            const client = createConversationClient({
                baseUrl: `http://127.0.0.1:${server.port}`,
                mode: 'http',
            });

            await expect(client.getConversation({ id: 'thread-1', source: 'codex' })).rejects.toThrow(
                new SpirachaClientError('Spiracha API returned invalid JSON.', 200),
            );
        } finally {
            server.stop(true);
        }
    });

    it('should delete conversations through the HTTP API with a DELETE request', async () => {
        const requests: Array<{ method: string; pathname: string }> = [];
        const server = Bun.serve({
            fetch(request) {
                const url = new URL(request.url);
                requests.push({ method: request.method, pathname: url.pathname });
                expect(request.method).toBe('DELETE');
                expect(url.pathname).toBe('/api/v1/conversations/claude-code/session-delete');

                return Response.json({
                    data: {
                        deletedFiles: ['/tmp/claude/session-delete.jsonl'],
                        deletedIds: ['session-delete'],
                    },
                });
            },
            port: 0,
        });

        try {
            const client = createConversationClient({
                baseUrl: `http://127.0.0.1:${server.port}`,
                mode: 'http',
            });

            await expect(client.deleteConversation({ id: 'session-delete', source: 'claude-code' })).resolves.toEqual({
                deletedFiles: ['/tmp/claude/session-delete.jsonl'],
                deletedIds: ['session-delete'],
            });
            expect(requests).toEqual([
                { method: 'DELETE', pathname: '/api/v1/conversations/claude-code/session-delete' },
            ]);
        } finally {
            server.stop(true);
        }
    });

    it('should delete explicit conversation sets through the HTTP API', async () => {
        const requests: Array<{ body: unknown; method: string; pathname: string }> = [];
        const server = Bun.serve({
            async fetch(request) {
                const url = new URL(request.url);
                requests.push({
                    body: await request.json(),
                    method: request.method,
                    pathname: url.pathname,
                });

                return Response.json({
                    data: {
                        deletedFiles: ['/tmp/opencode.db'],
                        deletedIds: ['session-1', 'session-2'],
                        missingIds: [],
                        results: [],
                    },
                });
            },
            port: 0,
        });

        try {
            const client = createConversationClient({
                baseUrl: `http://127.0.0.1:${server.port}`,
                mode: 'http',
            });

            await expect(
                client.deleteConversations({
                    ids: ['session-1', 'session-2'],
                    source: 'opencode',
                }),
            ).resolves.toEqual({
                deletedFiles: ['/tmp/opencode.db'],
                deletedIds: ['session-1', 'session-2'],
                missingIds: [],
                results: [],
            });
            expect(requests).toEqual([
                {
                    body: {
                        ids: ['session-1', 'session-2'],
                        source: 'opencode',
                    },
                    method: 'POST',
                    pathname: '/api/v1/conversations/delete',
                },
            ]);
        } finally {
            server.stop(true);
        }
    });

    it('should download explicit conversation export zips through the HTTP API', async () => {
        const requests: Array<{ body: unknown; method: string; pathname: string }> = [];
        const server = Bun.serve({
            async fetch(request) {
                const url = new URL(request.url);
                requests.push({
                    body: await request.json(),
                    method: request.method,
                    pathname: url.pathname,
                });

                return new Response(new Blob(['zip-bytes'], { type: 'application/zip' }), {
                    headers: {
                        'Content-Disposition': "attachment; filename*=UTF-8''grok-conversations-2.zip",
                        'Content-Type': 'application/zip',
                    },
                });
            },
            port: 0,
        });

        try {
            const client = createConversationClient({
                baseUrl: `http://127.0.0.1:${server.port}`,
                mode: 'http',
            });

            const download = await client.exportConversationsZip({
                ids: ['session-1', 'session-2'],
                source: 'grok',
            });

            expect(download).not.toBeNull();
            expect(download!.fileName).toBe('grok-conversations-2.zip');
            expect(download!.mimeType).toBe('application/zip');
            await expect(download!.blob.text()).resolves.toBe('zip-bytes');
            expect(requests).toEqual([
                {
                    body: {
                        ids: ['session-1', 'session-2'],
                        source: 'grok',
                    },
                    method: 'POST',
                    pathname: '/api/v1/conversations/export',
                },
            ]);
        } finally {
            server.stop(true);
        }
    });

    it('should return null for HTTP conversation deletes that no longer exist', async () => {
        const server = Bun.serve({
            fetch() {
                return Response.json({ error: { message: 'missing' } }, { status: 404 });
            },
            port: 0,
        });

        try {
            const client = createConversationClient({
                baseUrl: `http://127.0.0.1:${server.port}`,
                mode: 'http',
            });

            await expect(client.deleteConversation({ id: 'missing-session', source: 'kiro' })).resolves.toBeNull();
        } finally {
            server.stop(true);
        }
    });

    it('should reject local data locations on HTTP clients', async () => {
        const client = createConversationClient({
            baseUrl: 'http://127.0.0.1:3000',
            mode: 'http',
        });

        await expect(
            client.listConversations({
                cwd: '/repo',
                locations: { codexDbPath: '/tmp/codex.sqlite' },
            }),
        ).rejects.toThrow(new SpirachaClientError('`locations` is only supported by local Spiracha clients.'));
    });
});
