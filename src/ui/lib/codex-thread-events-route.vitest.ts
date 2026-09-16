import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        vi.resetAllMocks();
        vi.stubEnv('SPIRACHA_CODEX_DB', '');
        mocks.resolveCodexThreadDbPath.mockReturnValue('/tmp/codex.sqlite');
        mocks.createCodexThreadEventResponse.mockImplementation(() => new Response('stream'));
    });

    afterEach(() => vi.unstubAllEnvs());

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

    it.each(['https://evil.example', 'null', 'http://localhost:4000'])(
        'should deny origin %s before opening storage',
        async (origin) => {
            const response = await handleCodexThreadEventsRequest(
                new Request('http://127.0.0.1:3000/api/v1/codex/threads/events?threadId=one', {
                    headers: { Origin: origin },
                }),
            );
            expect(response.status).toBe(403);
            expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
            expect(mocks.resolveCodexThreadDbPath).not.toHaveBeenCalled();
            expect(mocks.getThreadBrowseDataBatch).not.toHaveBeenCalled();
            expect(mocks.createCodexThreadEventResponse).not.toHaveBeenCalled();
        },
    );

    it('should reject 65 unique subscriptions before opening storage', async () => {
        const url = new URL('http://localhost:3000/api/v1/codex/threads/events');
        for (let index = 0; index < 65; index += 1) {
            url.searchParams.append('threadId', `thread-${index}`);
        }
        const response = await handleCodexThreadEventsRequest(new Request(url));
        expect(response.status).toBe(400);
        expect(mocks.getThreadBrowseDataBatch).not.toHaveBeenCalled();
    });

    it('should allow 64 unique subscriptions and deduplicate before enforcing the limit', async () => {
        const url = new URL('http://localhost:3000/api/v1/codex/threads/events');
        const ids = Array.from({ length: 64 }, (_, index) => `thread-${index}`);
        for (const id of ids) {
            url.searchParams.append('threadId', ` ${id} `);
            url.searchParams.append('threadId', id);
        }
        url.searchParams.append('threadId', '   ');
        mocks.getThreadBrowseDataBatch.mockReturnValue(
            ids.map((threadId) => ({
                data: { thread: { rollout_path: `/tmp/${threadId}.jsonl` } },
                source: 'database',
                status: 'found',
                threadId,
            })),
        );
        const response = await handleCodexThreadEventsRequest(new Request(url));
        expect(response.status).toBe(200);
        expect(mocks.getThreadBrowseDataBatch).toHaveBeenCalledExactlyOnceWith('/tmp/codex.sqlite', ids);
    });

    it('should use the explicit database override and forward the request cancellation signal', async () => {
        vi.stubEnv('SPIRACHA_CODEX_DB', ' /tmp/isolated.sqlite ');
        mocks.getThreadBrowseDataBatch.mockReturnValue([
            {
                data: { thread: { rollout_path: '/tmp/one.jsonl' } },
                source: 'database',
                status: 'found',
                threadId: 'one',
            },
        ]);
        const controller = new AbortController();
        const request = new Request('http://localhost:3000/api/v1/codex/threads/events?threadId=one', {
            signal: controller.signal,
        });
        await handleCodexThreadEventsRequest(request);
        expect(mocks.resolveCodexThreadDbPath).not.toHaveBeenCalled();
        expect(mocks.getThreadBrowseDataBatch).toHaveBeenCalledWith('/tmp/isolated.sqlite', ['one']);
        expect(mocks.createCodexThreadEventResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                signal: request.signal,
            }),
        );
        controller.abort();
        expect(request.signal.aborted).toBe(true);
    });
});
