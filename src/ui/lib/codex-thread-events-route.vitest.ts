import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    class TestCodexThreadNotFoundError extends Error {
        constructor(threadId: string) {
            super(`Thread not found: ${threadId}`);
            this.name = 'CodexThreadNotFoundError';
        }
    }

    return {
        CodexThreadNotFoundError: TestCodexThreadNotFoundError,
        createCodexThreadEventResponse: vi.fn(() => new Response('stream')),
        getThreadBrowseDataBatch: vi.fn(),
        resolveCodexThreadDbPath: vi.fn(() => '/tmp/codex.sqlite'),
    };
});

vi.mock('@spiracha/lib/codex-database', () => ({
    CodexThreadNotFoundError: mocks.CodexThreadNotFoundError,
    resolveCodexThreadDbPath: mocks.resolveCodexThreadDbPath,
}));
vi.mock('@spiracha/lib/codex-browser-queries', () => ({
    getThreadBrowseDataBatch: mocks.getThreadBrowseDataBatch,
}));
vi.mock('@spiracha/lib/codex-thread-events', () => ({
    createCodexThreadEventResponse: mocks.createCodexThreadEventResponse,
}));

import { handleCodexThreadEventsRequest } from '../routes/api.v1.codex.threads.events';

describe('Codex thread events route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should allow the intentional localhost to 127.0.0.1 loopback stream and return CORS headers', async () => {
        const response = await handleCodexThreadEventsRequest(
            new Request('http://127.0.0.1:3000/api/v1/codex/threads/events', {
                headers: { Origin: 'http://localhost:3000' },
            }),
        );

        expect(response.status).toBe(400);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
        expect(response.headers.get('Vary')).toContain('Origin');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should batch all requested thread IDs once and preserve stream CORS headers', async () => {
        mocks.getThreadBrowseDataBatch.mockReturnValue([
            {
                data: { thread: { rollout_path: '/tmp/one.jsonl' } },
                source: 'database',
                status: 'found',
                threadId: 'one',
            },
            {
                data: { thread: { rollout_path: '/tmp/two.jsonl' } },
                source: 'fallback',
                status: 'found',
                threadId: 'two',
            },
        ]);

        const response = await handleCodexThreadEventsRequest(
            new Request('http://127.0.0.1:3000/api/v1/codex/threads/events?threadId=one&threadId=two', {
                headers: { Origin: 'http://localhost:3000' },
            }),
        );

        expect(mocks.getThreadBrowseDataBatch).toHaveBeenCalledTimes(1);
        expect(mocks.getThreadBrowseDataBatch).toHaveBeenCalledWith('/tmp/codex.sqlite', ['one', 'two']);
        expect(mocks.createCodexThreadEventResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                threads: [
                    { rolloutPath: '/tmp/one.jsonl', threadId: 'one' },
                    { rolloutPath: '/tmp/two.jsonl', threadId: 'two' },
                ],
            }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
        expect(response.headers.get('Vary')).toContain('Origin');
    });

    it('should return one CORS-enabled 404 when any requested thread is missing', async () => {
        mocks.getThreadBrowseDataBatch.mockReturnValue([
            {
                data: { thread: { rollout_path: '/tmp/one.jsonl' } },
                source: 'database',
                status: 'found',
                threadId: 'one',
            },
            { data: null, source: 'missing', status: 'missing', threadId: 'two' },
        ]);

        const response = await handleCodexThreadEventsRequest(
            new Request('http://127.0.0.1:3000/api/v1/codex/threads/events?threadId=one&threadId=two', {
                headers: { Origin: 'http://localhost:3000' },
            }),
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: 'Thread not found: two' });
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
        expect(response.headers.get('Vary')).toContain('Origin');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(mocks.createCodexThreadEventResponse).not.toHaveBeenCalled();
    });

    it('should preserve unreadable database failures from the batch browse seam', async () => {
        const failure = new Error('database is unreadable');
        mocks.getThreadBrowseDataBatch.mockImplementation(() => {
            throw failure;
        });

        await expect(
            handleCodexThreadEventsRequest(
                new Request('http://127.0.0.1:3000/api/v1/codex/threads/events?threadId=one'),
            ),
        ).rejects.toBe(failure);
        expect(mocks.createCodexThreadEventResponse).not.toHaveBeenCalled();
    });
});
