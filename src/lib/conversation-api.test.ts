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
                        messageSelector: 'last_final_answer',
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
                        deletedFiles: ['/tmp/opencode.db'],
                        deletedIds: ['session-1', 'session-2'],
                        missingIds: [],
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
                    return { deletedFiles: [], deletedIds: [], missingIds: [], results: [] };
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
        expect(response.headers.get('Content-Disposition')).toContain('grok-conversations-2.zip');
        expect(renderedSelectors).toEqual(['all', 'all']);
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
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
