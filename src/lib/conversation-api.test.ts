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
