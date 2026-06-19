import { describe, expect, it } from 'bun:test';
import { handleConversationApiRequest } from './conversation-api';
import type { ConversationDetail } from './conversation-data/types';

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

const createRequest = (path: string, init?: RequestInit) => new Request(`http://localhost:3000${path}`, init);

describe('conversation API handler', () => {
    it('should return source metadata in a stable envelope', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/sources'), {
            listConversationSources: async () => [
                {
                    label: 'Codex',
                    source: 'codex',
                },
            ],
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            data: [{ label: 'Codex', source: 'codex' }],
        });
    });

    it('should query conversations for a cwd with the last final answer selector', async () => {
        const response = await handleConversationApiRequest(
            createRequest('/api/v1/conversations?cwd=/repo&include_messages=true&message_selector=last_final_answer'),
            {
                listConversationsForPath: async (options) => {
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
            meta: { hasNext: false, next_cursor: null },
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
                listConversationsForPath: async (options) => {
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

    it('should return typed errors for missing required input', async () => {
        const response = await handleConversationApiRequest(createRequest('/api/v1/conversations'), {});

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: 'validation_error',
            },
        });
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
});
