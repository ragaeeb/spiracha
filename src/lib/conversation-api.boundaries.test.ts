import { describe, expect, it, mock, spyOn } from 'bun:test';
import { handleConversationApiRequest } from './conversation-api';
import type { ConversationDetail } from './conversation-data/types';

const detail = (id: string): ConversationDetail => ({
    createdAtMs: 1,
    deepLinks: { native: null, spiracha: `spiracha://conversation/codex/${id}`, ui: `/threads/${id}` },
    id,
    matches: [],
    messageCount: 0,
    messages: [],
    metadata: {},
    source: 'codex',
    title: id,
    updatedAtMs: 2,
    workspaceKey: null,
    workspacePath: '/fixture',
});
const post = (action: string, body: unknown) =>
    new Request(`http://localhost:3000/api/v1/conversations/${action}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });

const methodCases = [
    { allow: 'GET', pathname: '/sources' },
    { allow: 'GET', pathname: '/conversations' },
    { allow: 'GET', pathname: '/resolve' },
    { allow: 'POST', pathname: '/conversation-query' },
    { allow: 'POST', pathname: '/conversation-payload' },
    { allow: 'POST', pathname: '/conversations/delete' },
    { allow: 'POST', pathname: '/conversations/export' },
    { allow: 'DELETE, GET', pathname: '/conversations/codex/one' },
    { allow: 'GET', pathname: '/conversations/codex/one/export' },
    { allow: 'GET, HEAD', pathname: '/conversations/codex/one/raw' },
    { allow: 'POST', pathname: '/conversations/codex/one/evidence' },
];

describe('stable API contract boundaries', () => {
    it.each(methodCases)('should report the complete Allow contract for $pathname', async ({ allow, pathname }) => {
        const getConversation = mock(async () => detail('one'));
        const response = await handleConversationApiRequest(
            new Request(`http://localhost:3000/api/v1${pathname}`, { method: 'PATCH' }),
            { getConversation },
        );
        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe(allow);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(getConversation).not.toHaveBeenCalled();
    });

    it('should deny cross-origin destructive requests before invoking either mutation dependency', async () => {
        const deleteConversation = mock(async () => ({ deletedFiles: [], deletedIds: ['one'] }));
        const deleteConversations = mock(async () => null);
        for (const origin of ['null', 'http://localhost:3001', 'https://localhost:3000', 'http://evil.example']) {
            const request = post('delete', { ids: ['one'], source: 'codex' });
            request.headers.set('Origin', origin);
            const response = await handleConversationApiRequest(request, { deleteConversation, deleteConversations });
            expect(response.status).toBe(403);
            expect((await response.json()).error.code).toBe('origin_not_allowed');
        }
        expect(deleteConversation).not.toHaveBeenCalled();
        expect(deleteConversations).not.toHaveBeenCalled();
    });

    it('should reject the complete batch before mutation when any later ID is invalid', async () => {
        const deleteConversations = mock(async () => null);
        for (const invalidId of [null, 4, '', ' ', '../outside', 'a/b', 'a\\b', 'a\0b', 'x'.repeat(2049)]) {
            const response = await handleConversationApiRequest(
                post('delete', { ids: ['valid-first', invalidId], source: 'codex' }),
                { deleteConversations },
            );
            expect(response.status).toBe(400);
        }
        expect(deleteConversations).not.toHaveBeenCalled();
    });

    it('should enforce the 200-ID input cap before deduplication or source loading', async () => {
        const getConversation = mock(async () => detail('one'));
        const response = await handleConversationApiRequest(
            post('export', { ids: Array.from({ length: 201 }, () => 'one'), source: 'codex' }),
            { getConversation },
        );
        expect(response.status).toBe(400);
        expect(getConversation).not.toHaveBeenCalled();
    });

    it('should trim and deduplicate batch IDs while preserving their first requested order', async () => {
        const deleteConversations = mock(async () => ({
            deletedFiles: [],
            deletedIds: ['two', 'one'],
            missingIds: [],
            results: [],
        }));
        const response = await handleConversationApiRequest(
            post('delete', { ids: [' two ', 'one', 'two', ' one '], source: 'codex' }),
            { deleteConversations },
        );
        expect(response.status).toBe(200);
        expect(deleteConversations).toHaveBeenCalledTimes(1);
        expect(deleteConversations).toHaveBeenCalledWith({ ids: ['two', 'one'], source: 'codex' });
    });

    it('should return an atomic error rather than a partial ZIP when a requested conversation is missing', async () => {
        const getConversation = mock(async ({ id }: { id: string; }) => (id === 'missing' ? null : detail(id)));
        const response = await handleConversationApiRequest(
            post('export', { ids: ['present', 'missing', 'also-present'], source: 'codex' }),
            { getConversation },
        );
        expect(response.status).toBe(404);
        expect((await response.json()).error).toMatchObject({
            code: 'conversation_not_found',
            details: { ids: ['missing'], source: 'codex' },
        });
        expect(response.headers.get('Content-Disposition')).toBeNull();
        expect(getConversation).toHaveBeenCalledTimes(3);
    });

    it('should preserve partial delete success and cleanup failures in a successful response', async () => {
        const result = {
            cleanupFailures: [{ error: 'fixture cleanup failed', phase: 'files' }],
            deletedFiles: [],
            deletedIds: ['present'],
            missingIds: ['missing'],
            results: [
                { deleted: true, deletedFiles: [], deletedIds: ['present'], id: 'present' },
                { deleted: false, deletedFiles: [], deletedIds: [], id: 'missing' },
            ],
        };
        const response = await handleConversationApiRequest(
            post('delete', { ids: ['present', 'missing'], source: 'codex' }),
            { deleteConversations: async () => result },
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: result });
    });

    it('should reject malformed UTF-8 payload bytes before invoking conversion', async () => {
        const convertConversationPayload = mock(async () => []);
        const response = await handleConversationApiRequest(
            new Request('http://localhost:3000/api/v1/conversation-payload', {
                body: new Uint8Array([123, 34, 112, 34, 58, 34, 0xc3, 0x28, 34, 125]),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            }),
            { convertConversationPayload },
        );
        expect(response.status).toBe(400);
        expect(convertConversationPayload).not.toHaveBeenCalled();
    });

    it('should not expose adapter secrets in an HTTP error body', async () => {
        const log = spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const response = await handleConversationApiRequest(
                new Request('http://localhost:3000/api/v1/conversations/codex/one'),
                { getConversation: async () => { throw new Error('secret-token=/private/account/fixture'); } },
            );
            expect(response.status).toBe(500);
            const body = await response.text();
            expect(body).toContain('internal_error');
            expect(body).not.toContain('secret-token');
            expect(body).not.toContain('/private/account');
        } finally {
            log.mockRestore();
        }
    });
});
