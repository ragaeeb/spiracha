import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
            toolEvidence: null,
        },
    ],
    metadata: {},
    source: 'codex',
    title: 'Thread 1',
    updatedAtMs: 2,
    workspaceKey: 'folder:/repo',
    workspacePath: '/repo',
} satisfies ConversationDetail;

const runBunCommand = async (args: string[], cwd: string) => {
    const proc = Bun.spawn([process.execPath, ...args], {
        cwd,
        stderr: 'pipe',
        stdout: 'pipe',
    });
    const [exitCode, stderrText, stdoutText] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
        new Response(proc.stdout).text(),
    ]);
    return { exitCode, stderrText, stdoutText };
};

describe('conversation client', () => {
    it('should export focused evidence through the HTTP client contract', async () => {
        const requests: Array<{ body: unknown; method: string; pathname: string; search: string }> = [];
        const server = Bun.serve({
            async fetch(request) {
                const url = new URL(request.url);
                requests.push({
                    body: await request.json(),
                    method: request.method,
                    pathname: url.pathname,
                    search: url.search,
                });
                return Response.json({
                    data: {
                        markdown: '# Focused evidence: Thread 1\n',
                        meta: {
                            approximateTokens: 8,
                            episodeCount: 1,
                            generatedAt: '2026-07-19T12:00:00.000Z',
                            omission: {
                                budgetReached: false,
                                deduplicatedDiagnostics: 0,
                                inputCharacters: 100,
                                inputEvents: 2,
                                omittedBinaryPayloads: 0,
                                omittedEvents: 0,
                                selectedEvents: 2,
                                truncatedArrays: 0,
                                truncatedFields: 0,
                            },
                            projectedCharacters: 29,
                            rendererVersion: 'focused-evidence/v2',
                        },
                    },
                });
            },
            port: 0,
        });
        const evidenceLens = {
            anchors: [{ kind: 'tool' as const, names: ['exec'] }],
            budget: {
                commentaryCharactersPerEpisode: 200,
                failedOutputCharacters: 500,
                successfulOutputCharacters: 200,
                totalCharacters: 3000,
            },
            context: {
                commentaryAfter: 1,
                commentaryBefore: 1,
                followRetries: true,
                followWorkarounds: true,
                includeReasoningSummaries: false,
                maxOrderGap: 5,
            },
            name: 'CLI evidence',
        };

        try {
            const client = createConversationClient({ baseUrl: `http://127.0.0.1:${server.port}`, mode: 'http' });
            const result = await client.exportConversationEvidenceMarkdown({
                generatedAt: '2026-07-19T12:00:00.000Z',
                id: 'thread-1',
                lens: evidenceLens,
                source: 'codex',
            });
            expect(result?.markdown).toBe('# Focused evidence: Thread 1\n');
            expect(requests).toEqual([
                {
                    body: { generated_at: '2026-07-19T12:00:00.000Z', lens: evidenceLens },
                    method: 'POST',
                    pathname: '/api/v1/conversations/codex/thread-1/evidence',
                    search: '',
                },
            ]);
        } finally {
            server.stop(true);
        }
    });
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

    it('should support direct CLI imports from the installed package without starting a TanStack server', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spiracha-client-cli-'));
        try {
            const packageDirectory = path.join(tempRoot, 'package');
            const consumerDirectory = path.join(tempRoot, 'consumer');
            await Promise.all([mkdir(packageDirectory), mkdir(consumerDirectory)]);
            const { version } = (await Bun.file(path.join(process.cwd(), 'package.json')).json()) as {
                version: string;
            };
            const packagePath = path.join(packageDirectory, `spiracha-${version}.tgz`);
            const packResult = await runBunCommand(
                ['pm', 'pack', '--destination', packageDirectory, '--ignore-scripts', '--quiet'],
                process.cwd(),
            );
            expect(packResult.stderrText).toBe('');
            expect(packResult.exitCode, packResult.stderrText).toBe(0);

            await Bun.write(
                path.join(consumerDirectory, 'package.json'),
                `${JSON.stringify({ dependencies: { spiracha: `file:${packagePath}` }, private: true, type: 'module' }, null, 4)}\n`,
            );
            const installResult = await runBunCommand(['install', '--offline', '--ignore-scripts'], consumerDirectory);
            expect(installResult.stderrText).not.toContain('error:');
            expect(installResult.exitCode, installResult.stderrText).toBe(0);

            const locations = {
                antigravityRoots: [path.join(tempRoot, 'antigravity')],
                claudeCodeProjectsDir: path.join(tempRoot, 'claude'),
                codexDbPath: path.join(tempRoot, 'missing-codex.sqlite'),
                cursorUserDir: path.join(tempRoot, 'cursor'),
                kiroWorkspaceSessionsDir: path.join(tempRoot, 'kiro'),
                opencodeDbPath: path.join(tempRoot, 'missing-opencode.sqlite'),
                qoderGlobalStateDb: path.join(tempRoot, 'missing-qoder.sqlite'),
                qoderWorkspaceStorageDir: path.join(tempRoot, 'qoder-workspaces'),
            };
            const script = `
                import { createConversationClient } from 'spiracha/client';
                const client = createConversationClient({ locations: ${JSON.stringify(locations)}, mode: 'local' });
                if (typeof client.exportConversationEvidenceMarkdown !== 'function') {
                    throw new Error('The installed client is missing focused evidence export.');
                }
                const page = await client.listConversations({ cwd: ${JSON.stringify(path.join(tempRoot, 'repo'))} });
                console.log(JSON.stringify(page));
            `;
            const scriptPath = path.join(consumerDirectory, 'collect.ts');
            await Bun.write(scriptPath, script);
            const collectResult = await runBunCommand([scriptPath], consumerDirectory);

            expect(collectResult.stderrText).toBe('');
            expect(collectResult.exitCode, collectResult.stderrText).toBe(0);
            expect(JSON.parse(collectResult.stdoutText)).toEqual({
                data: [],
                meta: { hasNext: false, nextCursor: null },
            });
        } finally {
            await rm(tempRoot, { force: true, recursive: true });
        }
    }, 30_000);

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
                expect(url.searchParams.has('merged')).toBe(false);
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
                return Response.json(
                    { error: { code: 'conversation_not_found', message: 'missing' } },
                    { status: 404 },
                );
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

    it('should return null for unsupported HTTP conversation delete operations', async () => {
        const server = Bun.serve({
            fetch() {
                return Response.json(
                    {
                        error: {
                            code: 'unsupported_operation',
                            message: 'Deleting qoder conversations is not supported.',
                        },
                    },
                    { status: 405 },
                );
            },
            port: 0,
        });

        try {
            const client = createConversationClient({
                baseUrl: `http://127.0.0.1:${server.port}`,
                mode: 'http',
            });

            await expect(client.deleteConversation({ id: 'session-1', source: 'qoder' })).resolves.toBeNull();
            await expect(client.deleteConversations({ ids: ['session-1'], source: 'qoder' })).resolves.toBeNull();
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

    it('should reject oversized local export batches before hydrating conversations', async () => {
        const client = createConversationClient({ mode: 'local' });

        expect(
            client.exportConversationsZip({
                ids: Array.from({ length: 201 }, (_value, index) => `conversation-${index}`),
                source: 'codex',
            }),
        ).rejects.toThrow(new SpirachaClientError('At most 200 conversation ids may be exported at once.'));
    });

    it('should preserve a configured HTTP base path prefix', async () => {
        const originalFetch = globalThis.fetch;
        const requestedUrls: string[] = [];
        globalThis.fetch = (async (input) => {
            requestedUrls.push(String(input));
            return Response.json({ data: [] });
        }) as typeof fetch;

        try {
            const client = createConversationClient({ baseUrl: 'https://example.com/spiracha', mode: 'http' });
            await client.listSources();
            expect(requestedUrls).toEqual(['https://example.com/spiracha/api/v1/sources']);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('should surface a route-level 404 instead of treating it as a missing conversation', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            Response.json(
                { error: { code: 'not_found', message: 'API route not found.' } },
                { status: 404 },
            )) as unknown as typeof fetch;

        try {
            const client = createConversationClient({ baseUrl: 'https://example.com/spiracha', mode: 'http' });
            await expect(client.getConversation({ id: 'thread-1', source: 'codex' })).rejects.toThrow(
                new SpirachaClientError('Spiracha API request failed (404): API route not found.', 404),
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
