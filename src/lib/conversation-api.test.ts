import { describe, expect, it } from 'bun:test';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { unzipSync } from 'fflate';
import { handleConversationApiRequest } from './conversation-api';
import { OriginalRepresentationUnavailableError, SourceChangedError } from './conversation-data';
import { toCanonicalMessage } from './conversation-data/adapter-helpers';
import type { ConversationDetail, ConversationSourceInfo } from './conversation-data/types';
import { chatgptResearchPayload, chatgptResearchReport } from './conversation-payload-test-helpers';
import type { ConvertedConversation } from './conversation-payload-types';

const conversation = {
    bodyAvailability: 'full',
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
        toCanonicalMessage({
            createdAtMs: 2,
            id: 'message-1',
            metadata: {},
            order: 0,
            phase: 'final_answer',
            role: 'assistant',
            text: 'Collected review output.',
            toolEvidence: null,
        }),
    ],
    metadata: {},
    source: 'codex',
    title: 'Thread 1',
    updatedAtMs: 2,
    workspaceKey: 'folder:/repo',
    workspacePath: '/repo',
} satisfies ConversationDetail;

const validLens = {
    anchors: [{ kind: 'text', literals: ['review'] }],
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
    name: 'Review evidence',
};

const convertedPayload = [
    {
        artifacts: [{ content: '# Findings\n', id: 'report', title: 'Research report' }],
        createdAtMs: null,
        id: 'payload-1',
        markdown: '# Findings\n',
        messages: [],
        metadata: {},
        source: 'web',
        title: 'Research report',
        updatedAtMs: null,
        workspacePath: null,
    },
] satisfies ConvertedConversation[];

const createRequest = (path: string, init?: RequestInit) => new Request(`http://localhost:3000${path}`, init);

describe('conversation API handler', () => {
    it('should convert supplied payloads through the stable API and preserve artifacts', async () => {
        let receivedOptions: unknown;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversation-payload', {
                body: JSON.stringify({
                    file_name: 'Gemini.json',
                    message_selector: 'all',
                    payload: { messages: [{ content: 'Research complete.', role: 'assistant' }] },
                    source: 'web',
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            }),
            {
                convertConversationPayload: async (options) => {
                    receivedOptions = options;
                    return convertedPayload;
                },
            },
        );

        expect(response.status).toBe(200);
        expect(receivedOptions).toEqual({
            fileName: 'Gemini.json',
            messageSelector: 'all',
            payload: { messages: [{ content: 'Research complete.', role: 'assistant' }] },
            source: 'web',
        });
        await expect(response.json()).resolves.toEqual({ data: convertedPayload });
    });

    it('should expose ChatGPT Deep Research artifacts through the stable API', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversation-payload', {
                body: JSON.stringify({ file_name: 'chatgpt.json', payload: chatgptResearchPayload, source: 'web' }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            data: [
                {
                    artifacts: [
                        {
                            content: chatgptResearchReport,
                            id: 'chatgpt-deep-research:report:chatgpt-report-message',
                            title: 'REPORT.md',
                        },
                    ],
                },
            ],
        });
    });

    it('should return payload conversion errors as stable validation responses', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversation-payload', {
                body: JSON.stringify({ payload: { invalid: true }, source: 'made-up' }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            }),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: { code: 'unsupported_source', field: 'payload' },
            },
        });
    });

    it('should reject an oversized payload request before conversion', async () => {
        let converted = false;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversation-payload', {
                body: '{}',
                headers: {
                    'Content-Length': String(64 * 1024 * 1024 + 1),
                    'Content-Type': 'application/json',
                },
                method: 'POST',
            }),
            {
                convertConversationPayload: async () => {
                    converted = true;
                    return [];
                },
            },
        );

        expect(response.status).toBe(413);
        expect(converted).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: { field: 'payload', reason: 'request_too_large' },
            },
        });
    });

    it('should enforce the payload limit for a chunked request without Content-Length', async () => {
        let chunkCount = 0;
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            cancel: () => {
                cancelled = true;
            },
            pull: (controller) => {
                chunkCount += 1;
                controller.enqueue(new Uint8Array(1024 * 1024));
            },
        });
        let converted = false;

        const response = await handleConversationApiRequest(
            new Request('http://localhost:3000/api/v1/conversation-payload', {
                body,
                duplex: 'half',
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            } as RequestInit & { duplex: 'half' }),
            {
                convertConversationPayload: async () => {
                    converted = true;
                    return [];
                },
            },
        );

        expect(response.status).toBe(413);
        expect(chunkCount).toBeLessThanOrEqual(65);
        expect(cancelled).toBe(true);
        expect(converted).toBe(false);
    });

    it('should reject unsupported methods for the payload endpoint', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/conversation-payload'));

        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe('POST');
    });

    it('should reject cross-origin requests before loading conversations', async () => {
        let loaded = false;
        const response = await handleConversationApiRequest(
            new Request('http://localhost:3000/api/v1/sources', {
                headers: { Origin: 'http://evil.example' },
            }),
            {
                listConversationSources: async () => {
                    loaded = true;
                    return [];
                },
            },
        );

        expect(response.status).toBe(403);
        expect(loaded).toBe(false);
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should export focused evidence through the stable POST envelope', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/codex/thread-1/evidence', {
                body: JSON.stringify({
                    generated_at: '2026-07-19T12:00:00.000Z',
                    lens: validLens,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            }),
            { getConversation: async () => conversation },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            data: {
                markdown: expect.stringContaining('# Focused evidence: Thread 1'),
                meta: {
                    generatedAt: '2026-07-19T12:00:00.000Z',
                    rendererVersion: 'focused-evidence/v3',
                },
            },
        });
    });

    it('should identify the exact invalid lens path before loading a conversation', async () => {
        let loaded = false;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/codex/thread-1/evidence', {
                body: JSON.stringify({ lens: { anchors: [], budget: {}, context: {}, name: 'Invalid', typo: true } }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            }),
            {
                getConversation: async () => {
                    loaded = true;
                    return conversation;
                },
            },
        );

        expect(response.status).toBe(400);
        expect(loaded).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'lens.typo',
                    value: { anchors: [], budget: {}, context: {}, name: 'Invalid', typo: true },
                },
            },
        });
    });

    it('should reject invalid generated timestamps without loading a conversation', async () => {
        let loaded = false;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/codex/thread-1/evidence', {
                body: JSON.stringify({
                    generated_at: 'not-a-date',
                    lens: validLens,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            }),
            {
                getConversation: async () => {
                    loaded = true;
                    return conversation;
                },
            },
        );

        expect(response.status).toBe(400);
        expect(loaded).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'validation_error', details: { field: 'generated_at' } },
        });
    });
    it('should return source metadata in a stable envelope', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/sources'), {
            listConversationSources: async () => [
                {
                    detailRouteSegment: 'threads',
                    exportPlatform: 'codex',
                    inventoryPath: '/codex',
                    label: 'Codex',
                    operations: {
                        batch_delete: { owner: 'source_mutator', state: 'supported' },
                        delete: { owner: 'source_mutator', state: 'supported' },
                        detail: { owner: 'source_reader', state: 'supported' },
                        list: { owner: 'source_reader', state: 'supported' },
                        original_raw: { owner: 'source_reader', state: 'supported' },
                    },
                    scope: 'workspace',
                    source: 'codex',
                } satisfies ConversationSourceInfo,
            ],
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            data: [
                {
                    detailRouteSegment: 'threads',
                    exportPlatform: 'codex',
                    inventoryPath: '/codex',
                    label: 'Codex',
                    operations: {
                        batch_delete: { owner: 'source_mutator', state: 'supported' },
                        delete: { owner: 'source_mutator', state: 'supported' },
                        detail: { owner: 'source_reader', state: 'supported' },
                        list: { owner: 'source_reader', state: 'supported' },
                        original_raw: { owner: 'source_reader', state: 'supported' },
                    },
                    scope: 'workspace',
                    source: 'codex',
                },
            ],
            meta: { schema_version: 1 },
        });
    });

    it('should publish declared source operations without inventing exceptions', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/sources'));
        const body = (await response.json()) as {
            data: ConversationSourceInfo[];
            meta: { schema_version: number };
        };

        expect(response.status).toBe(200);
        expect(body.meta).toEqual({ schema_version: 1 });
        expect(body.data.map((entry) => entry.source).sort()).toEqual([
            'antigravity',
            'claude-code',
            'cline',
            'codex',
            'command-code',
            'cursor',
            'fx',
            'grok',
            'grok-bot',
            'kiro',
            'minimax-code',
            'opencode',
            'qoder',
        ]);
        expect(body.data.find((entry) => entry.source === 'opencode')?.operations.original_raw).toEqual({
            reason: 'OpenCode stores conversations in shared relational tables with no standalone native conversation file.',
            reasonCode: 'no_native_conversation_file',
            state: 'unsupported',
        });
        expect(body.data.find((entry) => entry.source === 'cursor')?.operations.original_raw).toEqual({
            owner: 'source_reader',
            state: 'supported',
        });
        expect(body.data.find((entry) => entry.source === 'qoder')?.operations.delete).toEqual({
            owner: 'source_mutator',
            state: 'supported',
        });
        expect(body.data.find((entry) => entry.source === 'codex')?.operations.normalized_export).toEqual({
            owner: 'common_service',
            state: 'supported',
        });
        expect(body.data.find((entry) => entry.source === 'codex')?.operations.deletion_reconciliation).toEqual({
            owner: 'source_mutator',
            state: 'supported',
        });
        expect(body.data.find((entry) => entry.source === 'cline')?.operations.deletion_reconciliation).toBeUndefined();
    });

    it('should accept Command Code as a stable workspace source', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&source=command-code&include_messages=true'),
            {
                listConversations: async (options) => {
                    expect(options).toMatchObject({
                        cwd: '/repo',
                        includeMessages: true,
                        sources: ['command-code'],
                    });
                    return { data: [], meta: { hasNext: false, nextCursor: null } };
                },
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ data: [] });
    });

    it('should query conversations for a cwd with the last final answer selector', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&include_messages=true&message_selector=last_final_answer'),
            {
                listConversations: async (options) => {
                    expect(options).toMatchObject({
                        cwd: '/repo',
                        includeMessages: true,
                        messageSelector: 'last_final_answer',
                    });
                    return {
                        data: [conversation],
                        meta: { hasNext: false, nextCursor: null },
                    };
                },
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            data: [conversation],
            meta: { has_next: false, next_cursor: null },
        });
    });

    it('should reject a relative cwd instead of resolving it against the server process', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=relative/repo'),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: { field: 'cwd' },
            },
        });
    });

    it('should reject a whitespace-only cwd instead of treating it as global scope', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/conversations?cwd=%20%20'), {});

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'validation_error', details: { field: 'cwd' } },
        });
    });

    it('should accept snake_case JSON options for conversation query clients', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversation-query', {
                body: JSON.stringify({
                    cwd: '/repo',
                    include_messages: true,
                    limit: 250,
                    message_selector: 'last_final_answer',
                    source: 'codex,qoder',
                    updated_after_ms: 100,
                    updated_before_ms: 200,
                }),
                method: 'POST',
            }),
            {
                listConversations: async (options) => {
                    expect(options).toMatchObject({
                        cwd: '/repo',
                        includeMessages: true,
                        limit: 200,
                        messageSelector: 'last_final_answer',
                        sources: ['codex', 'qoder'],
                        updatedAfterMs: 100,
                        updatedBeforeMs: 200,
                    });
                    return {
                        data: [conversation],
                        meta: { hasNext: false, nextCursor: null },
                    };
                },
            },
        );

        expect(response.status).toBe(200);
    });

    it('should deduplicate repeated source filters before adapter fan-out', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&source=codex,codex'),
            {
                listConversations: async (options) => {
                    expect(options.sources).toEqual(['codex']);
                    return { data: [], meta: { hasNext: false, nextCursor: null } };
                },
            },
        );

        expect(response.status).toBe(200);
    });

    it('should allow global list queries without a cwd', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/conversations?source=grok-bot'), {
            listConversations: async (options) => {
                expect(options.cwd).toBeUndefined();
                expect(options.sources).toEqual(['grok-bot']);
                return { data: [], meta: { hasNext: false, nextCursor: null } };
            },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            data: [],
            meta: { has_next: false, next_cursor: null },
        });
    });

    it('should reject source scopes that do not match the list scope', async () => {
        const workspaceResponse = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&source=grok-bot'),
            {},
        );
        const globalResponse = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?source=codex'),
            {},
        );

        expect(workspaceResponse.status).toBe(400);
        expect(globalResponse.status).toBe(400);
        await expect(workspaceResponse.json()).resolves.toMatchObject({ error: { code: 'validation_error' } });
        await expect(globalResponse.json()).resolves.toMatchObject({ error: { code: 'validation_error' } });
    });

    it('should not dispatch GET batch-action paths to the conversation list handler', async () => {
        for (const action of ['delete', 'export']) {
            let listCalled = false;
            const response = await handleConversationApiRequest(
                createRequest(`/api/v1/conversations/${action}?cwd=/repo`),
                {
                    listConversations: async () => {
                        listCalled = true;
                        return { data: [], meta: { hasNext: false, nextCursor: null } };
                    },
                },
            );

            expect(response.status).toBe(405);
            expect(response.headers.get('Allow')).toBe('POST');
            expect(listCalled).toBe(false);
        }
    });

    it('should reject unsupported source filters', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&source=bogus'),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'source',
                    source: 'bogus',
                },
            },
        });
    });

    it('should reject unsupported message selectors', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversation-query', {
                body: JSON.stringify({
                    cwd: '/repo',
                    messageSelector: 'review_only',
                }),
                method: 'POST',
            }),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'message_selector',
                    message_selector: 'review_only',
                },
            },
        });
    });

    it('should reject invalid cursors and timestamps', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&cursor=not-base64&updated_after_ms=-1'),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'cursor',
                },
            },
        });
    });

    it('should reject malformed numeric and boolean JSON options', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversation-query', {
                body: JSON.stringify({
                    cwd: '/repo',
                    include_messages: 'true',
                    limit: '25',
                }),
                method: 'POST',
            }),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'limit',
                },
            },
        });
    });

    it('should reject non-string JSON cwd options without throwing', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversation-query', {
                body: JSON.stringify({
                    cwd: { path: '/repo' },
                }),
                method: 'POST',
            }),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'cwd',
                },
            },
        });
    });

    it('should reject malformed numeric query options', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&limit=abc'),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'limit',
                },
            },
        });
    });

    it('should reject fractional timestamp query options', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&updated_after_ms=1.5'),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'updated_after_ms',
                },
            },
        });
    });

    it('should reject malformed conversation ids instead of throwing', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/conversations/codex/%E0%A4%A'), {});

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'id',
                },
            },
        });
    });

    it('should reject extra API path segments and include Allow for known resources', async () => {
        const extraSegment = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/codex/thread-1/export/extra'),
            {},
        );
        const wrongMethod = await handleConversationApiRequest(
            createRequest('/api/v1/sources', { method: 'POST' }),
            {},
        );

        expect(extraSegment.status).toBe(404);
        expect(wrongMethod.status).toBe(405);
        expect(wrongMethod.headers.get('Allow')).toBe('GET');
        expect(wrongMethod.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should resolve conversation refs through the API', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/resolve?ref=spiracha://conversation/codex/thread-1'),
            {
                resolveConversationRef: async (ref) => {
                    expect(ref).toBe('spiracha://conversation/codex/thread-1');
                    return { id: 'thread-1', source: 'codex' };
                },
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            data: { id: 'thread-1', source: 'codex' },
        });
    });

    it('should return conversation detail with all messages by default', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/conversations/codex/thread-1'), {
            getConversation: async (options) => {
                expect(options).toEqual({ id: 'thread-1', messageSelector: 'all', source: 'codex' });
                return conversation;
            },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ data: conversation });
    });

    it('should export one conversation with the requested message selector', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/codex/thread-1/export?message_selector=last_final_answer'),
            {
                getConversation: async (options) => {
                    expect(options).toEqual({
                        id: 'thread-1',
                        messageSelector: 'all',
                        source: 'codex',
                    });
                    return conversation;
                },
                renderConversationMarkdown: (renderedConversation, options) => {
                    expect(renderedConversation).toBe(conversation);
                    expect(options).toEqual({ messageSelector: 'last_final_answer' });
                    return '# Thread 1\n';
                },
            },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
        await expect(response.text()).resolves.toBe('# Thread 1\n');
    });

    it('should pass compact export flags through Markdown export', async () => {
        const response = await handleConversationApiRequest(
            createRequest(
                '/api/v1/conversations/codex/thread-1/export?include_commentary=false&include_tools=false&format=txt',
            ),
            {
                getConversation: async () => conversation,
                renderConversationMarkdown: (_renderedConversation, options) => {
                    expect(options).toEqual({
                        includeCommentary: false,
                        includeTools: false,
                        messageSelector: 'all',
                        outputFormat: 'txt',
                    });
                    return 'Thread 1\n';
                },
            },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        await expect(response.text()).resolves.toBe('Thread 1\n');
    });

    it('should pass through a raw transcript without parsing or rewriting it', async () => {
        const original = '{"z":1, "spacing":  true}\n';
        const response = await handleConversationApiRequest(createRequest('/api/v1/conversations/codex/thread-1/raw'), {
            getConversationRaw: async (options) => {
                expect(options).toEqual({ id: 'thread-1', source: 'codex' });
                return {
                    blob: new Blob([original]),
                    fileName: 'messages.jsonl',
                    mimeType: 'application/x-ndjson',
                };
            },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Disposition')).toBe("attachment; filename*=UTF-8''messages.jsonl");
        expect(response.headers.get('Content-Type')).toBe('application/x-ndjson');
        await expect(response.text()).resolves.toBe(original);
    });

    it('should preserve binary raw bytes and the native blob extension over HTTP', async () => {
        const original = new Uint8Array([0, 255, 192, 65, 13, 10]);
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/grok-bot/chat-1/raw'),
            {
                getConversationRaw: async () => ({
                    blob: new Blob([original]),
                    fileName: '../replica.blob',
                    mimeType: 'application/json',
                }),
            },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Disposition')).toBe("attachment; filename*=UTF-8''replica.blob");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
    });

    it('should expose raw transcript headers without sending a body to HEAD probes', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/codex/thread-1/raw', { method: 'HEAD' }),
            {
                getConversationRaw: async () => ({
                    blob: new Blob(['must not be sent']),
                    fileName: 'thread 1.jsonl',
                    mimeType: 'application/x-ndjson',
                }),
            },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Disposition')).toBe("attachment; filename*=UTF-8''thread%201.jsonl");
        await expect(response.text()).resolves.toBe('');
    });

    it('should reject message selectors for raw transcript passthroughs', async () => {
        let loaded = false;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/codex/thread-1/raw?message_selector=last_final_answer'),
            {
                getConversationRaw: async () => {
                    loaded = true;
                    return null;
                },
            },
        );

        expect(response.status).toBe(400);
        expect(loaded).toBe(false);
    });

    it('should reject OpenCode raw as an unsupported operation before source I/O', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/opencode/session-1/raw'),
        );

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'unsupported_operation',
                details: {
                    operation: 'original_raw',
                    reason_code: 'no_native_conversation_file',
                    source: 'opencode',
                },
            },
        });
    });

    it('should refuse a raw transcript whose source file changed during the read', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/cursor/thread-1/raw'),
            {
                getConversationRaw: async () => {
                    throw new SourceChangedError();
                },
            },
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'source_changed',
                details: { id: 'thread-1', reason_code: 'source_changed', source: 'cursor' },
            },
        });
    });

    it('should distinguish missing native files from a missing conversation', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/cursor/thread-1/raw'),
            {
                getConversationRaw: async () => {
                    throw new OriginalRepresentationUnavailableError('cursor', 'thread-1');
                },
            },
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'original_representation_unavailable',
                details: { id: 'thread-1', source: 'cursor' },
            },
        });
    });

    it('should delete supported conversations through the public API', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/grok/019f2e0a-a16c-7120-97da-8fae66e36731', { method: 'DELETE' }),
            {
                deleteConversation: async (options) => {
                    expect(options).toEqual({
                        id: '019f2e0a-a16c-7120-97da-8fae66e36731',
                        source: 'grok',
                    });
                    return {
                        deletedFiles: ['/Users/user/.grok/sessions/project/session/chat_history.jsonl'],
                        deletedIds: ['session/encoded'],
                    };
                },
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            data: {
                deletedFiles: ['/Users/user/.grok/sessions/project/session/chat_history.jsonl'],
                deletedIds: ['session/encoded'],
            },
        });
    });

    it('should forward Cursor session-file preservation through delete requests', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/cursor/thread-1?delete_session_files=false', {
                method: 'DELETE',
            }),
            {
                deleteConversation: async (options) => {
                    expect(options).toEqual({ deleteSessionFiles: false, id: 'thread-1', source: 'cursor' });
                    return { deletedFiles: ['/tmp/global.db'], deletedIds: ['thread-1'] };
                },
            },
        );

        expect(response.status).toBe(200);
    });

    it('should delete an explicit set of conversations through the public API', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/delete', {
                body: JSON.stringify({
                    ids: ['session-1', 'session-2'],
                    source: 'opencode',
                }),
                method: 'POST',
            }),
            {
                deleteConversations: async (options) => {
                    expect(options).toEqual({
                        ids: ['session-1', 'session-2'],
                        source: 'opencode',
                    });
                    return {
                        affectedIds: ['session-1', 'session-2'],
                        deletedFiles: ['/tmp/opencode.db'],
                        deletedIds: ['session-1', 'session-2'],
                        missingIds: [],
                        outcomes: [
                            {
                                affectedIds: ['session-1'],
                                coveredBy: null,
                                deletedFiles: ['/tmp/opencode.db'],
                                id: 'session-1',
                                status: 'deleted' as const,
                            },
                            {
                                affectedIds: ['session-2'],
                                coveredBy: null,
                                deletedFiles: [],
                                id: 'session-2',
                                status: 'deleted' as const,
                            },
                        ],
                        request: {
                            duplicateCount: 0,
                            ids: ['session-1', 'session-2'],
                            uniqueIds: ['session-1', 'session-2'],
                        },
                        results: [
                            {
                                deleted: true,
                                deletedFiles: ['/tmp/opencode.db'],
                                deletedIds: ['session-1'],
                                id: 'session-1',
                            },
                            {
                                deleted: true,
                                deletedFiles: [],
                                deletedIds: ['session-2'],
                                id: 'session-2',
                            },
                        ],
                        summary: { cancelled: 0, cleanupPending: 0, deleted: 2, failed: 0, missing: 0 },
                    };
                },
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            data: {
                deletedIds: ['session-1', 'session-2'],
                missingIds: [],
            },
        });
    });

    it('should forward Cursor session-file preservation through batch delete requests', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/delete', {
                body: JSON.stringify({ delete_session_files: false, ids: ['thread-1'], source: 'cursor' }),
                method: 'POST',
            }),
            {
                deleteConversations: async (options) => {
                    expect(options).toEqual({ deleteSessionFiles: false, ids: ['thread-1'], source: 'cursor' });
                    return {
                        affectedIds: [],
                        deletedFiles: [],
                        deletedIds: [],
                        missingIds: ['thread-1'],
                        outcomes: [{ affectedIds: [], deletedFiles: [], id: 'thread-1', status: 'missing' as const }],
                        request: { duplicateCount: 0, ids: ['thread-1'], uniqueIds: ['thread-1'] },
                        results: [],
                        summary: { cancelled: 0, cleanupPending: 0, deleted: 0, failed: 0, missing: 1 },
                    };
                },
            },
        );

        expect(response.status).toBe(404);
    });

    it('should reject unsafe destructive ids before reaching delete handlers', async () => {
        let called = false;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/cursor/thread%25wildcard', { method: 'DELETE' }),
            {
                deleteConversation: async () => {
                    called = true;
                    return { deletedFiles: [], deletedIds: ['thread%wildcard'] };
                },
            },
        );

        expect(response.status).toBe(400);
        expect(called).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'id',
                },
            },
        });
    });

    it('should reject repeated-dot destructive ids before reaching delete handlers', async () => {
        let called = false;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/grok/session..backup', { method: 'DELETE' }),
            {
                deleteConversation: async () => {
                    called = true;
                    return { deletedFiles: [], deletedIds: [] };
                },
            },
        );

        expect(response.status).toBe(400);
        expect(called).toBe(false);
    });

    it('should return the stable error envelope when a delete adapter throws', async () => {
        const consoleError = console.error;
        console.error = () => {};

        try {
            const response = await handleConversationApiRequest(
                createRequest('/api/v1/conversations/grok/session-1', { method: 'DELETE' }),
                {
                    deleteConversation: async () => {
                        throw new Error('source database is locked');
                    },
                },
            );

            expect(response.status).toBe(500);
            await expect(response.json()).resolves.toEqual({
                error: {
                    code: 'internal_error',
                    message: 'Conversation API request failed.',
                },
            });
        } finally {
            console.error = consoleError;
        }
    });

    it('should reject unsafe destructive ids in batch deletes before reaching delete handlers', async () => {
        let called = false;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/delete', {
                body: JSON.stringify({
                    ids: ['safe-id', 'thread%wildcard'],
                    source: 'grok',
                }),
                method: 'POST',
            }),
            {
                deleteConversations: async () => {
                    called = true;
                    return {
                        affectedIds: [],
                        deletedFiles: [],
                        deletedIds: [],
                        missingIds: [],
                        outcomes: [],
                        request: { duplicateCount: 0, ids: [], uniqueIds: [] },
                        results: [],
                        summary: { cancelled: 0, cleanupPending: 0, deleted: 0, failed: 0, missing: 0 },
                    };
                },
            },
        );

        expect(response.status).toBe(400);
        expect(called).toBe(false);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'id',
                },
            },
        });
    });

    it('should reject unsafe ids in batch exports before reaching source adapters', async () => {
        let called = false;
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/export', {
                body: JSON.stringify({ ids: ['../outside'], source: 'cursor' }),
                method: 'POST',
            }),
            {
                getConversation: async () => {
                    called = true;
                    return null;
                },
            },
        );

        expect(response.status).toBe(400);
        expect(called).toBe(false);
    });

    it('should zip an explicit set of conversations through the public API with all messages by default', async () => {
        const renderedSelectors: Array<string | undefined> = [];
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/export', {
                body: JSON.stringify({
                    ids: ['thread-1', 'thread-2'],
                    source: 'grok',
                }),
                method: 'POST',
            }),
            {
                getConversation: async (options) => {
                    expect(options.messageSelector).toBe('all');
                    return {
                        ...conversation,
                        id: options.id,
                        source: options.source,
                        title: options.id,
                    };
                },
                renderConversationMarkdown: (renderedConversation, options) => {
                    renderedSelectors.push(options?.messageSelector);
                    return `# ${renderedConversation.title}\n\n## Assistant\n\nExported conversation\n`;
                },
            },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/zip');
        expect(response.headers.get('Content-Disposition')).toContain('grok_repo-1970-01-01-0000-threads-2.zip');
        expect(renderedSelectors).toEqual(['all', 'all']);
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    });

    it('should carry a ZIP password through the public API without exposing it in the manifest', async () => {
        const password = '  API password 🔐  ';
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/export', {
                body: JSON.stringify({ ids: ['thread-1'], source: 'grok', zip_password: password }),
                method: 'POST',
            }),
            {
                getConversation: async () => conversation,
                renderConversationMarkdown: () => '# Exported\n',
            },
        );

        expect(response.status).toBe(200);
        const reader = new ZipReader(new BlobReader(await response.blob()));
        const entries = await reader.getEntries();
        expect(entries).toHaveLength(2);
        expect(entries.every((entry) => entry.encrypted)).toBe(true);
        const manifestEntry = entries.find((entry) => entry.filename === 'spiracha-manifest.json');
        if (!manifestEntry || manifestEntry.directory) {
            throw new Error('expected an encrypted manifest file entry');
        }
        const manifest = JSON.parse(new TextDecoder().decode(await manifestEntry.arrayBuffer({ password }))) as {
            options: Record<string, unknown>;
        };
        expect(manifest.options).not.toHaveProperty('zipPassword');
        await reader.close();
    });

    it('should refuse atomic batch export when any requested conversation is missing', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/export', {
                body: JSON.stringify({ ids: ['thread-1', 'missing'], source: 'grok' }),
                method: 'POST',
            }),
            {
                getConversation: async (options) => (options.id === 'missing' ? null : conversation),
            },
        );

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'conversation_not_found',
                details: { ids: ['missing'], source: 'grok' },
            },
        });
    });

    it('should publish a partial batch zip with a generated manifest when some ids are missing', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/export', {
                body: JSON.stringify({
                    failure_policy: 'partial',
                    ids: ['thread-1', 'missing'],
                    source: 'grok',
                }),
                method: 'POST',
            }),
            {
                getConversation: async (options) =>
                    options.id === 'missing' ? null : { ...conversation, id: options.id, title: options.id },
                renderConversationMarkdown: (rendered) => `# ${rendered.title ?? rendered.model ?? 'conversation'}`,
            },
        );

        expect(response.status).toBe(200);
        const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
        expect(Object.keys(archive).sort()).toEqual(['spiracha-manifest.json', 'thread-1.md'].sort());
        const manifest = JSON.parse(Buffer.from(archive['spiracha-manifest.json']!).toString()) as {
            failurePolicy: string;
            missingCount: number;
            successCount: number;
        };
        expect(manifest).toMatchObject({ failurePolicy: 'partial', missingCount: 1, successCount: 1 });
    });

    it('should load batch export conversations with bounded concurrency while preserving input order', async () => {
        let active = 0;
        let maxActive = 0;
        const renderedIds: string[] = [];
        const ids = Array.from({ length: 9 }, (_, index) => `thread-${index}`);
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/export', {
                body: JSON.stringify({ ids, source: 'grok' }),
                method: 'POST',
            }),
            {
                getConversation: async (options) => {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    await Bun.sleep(2);
                    active -= 1;
                    return { ...conversation, id: options.id, source: options.source, title: options.id };
                },
                renderConversationMarkdown: (renderedConversation) => {
                    renderedIds.push(renderedConversation.title ?? '');
                    return `# ${renderedConversation.title ?? ''}`;
                },
            },
        );

        expect(response.status).toBe(200);
        expect(maxActive).toBeGreaterThan(1);
        expect(maxActive).toBeLessThanOrEqual(4);
        expect(renderedIds).toEqual(ids);
    });

    it('should reject unsupported batch export formats', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/export', {
                body: JSON.stringify({
                    ids: ['thread-1'],
                    output_format: 'txt',
                    source: 'grok',
                }),
                method: 'POST',
            }),
            {},
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
                details: {
                    field: 'output_format',
                },
            },
        });
    });

    it('should report unsupported and missing deletes without deleting anything else', async () => {
        const unsupported = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/qoder/session-delete', { method: 'DELETE' }),
            {
                deleteConversation: async (options) => {
                    expect(options).toEqual({ id: 'session-delete', source: 'qoder' });
                    return null;
                },
            },
        );
        const missing = await handleConversationApiRequest(
            createRequest('/api/v1/conversations/claude-code/missing-session', { method: 'DELETE' }),
            {
                deleteConversation: async () => ({ deletedFiles: [], deletedIds: [] }),
            },
        );

        expect(unsupported.status).toBe(405);
        await expect(unsupported.json()).resolves.toMatchObject({
            error: {
                code: 'unsupported_operation',
                details: {
                    source: 'qoder',
                },
            },
        });
        expect(missing.status).toBe(404);
        await expect(missing.json()).resolves.toMatchObject({
            error: {
                code: 'conversation_not_found',
            },
        });
    });
});
