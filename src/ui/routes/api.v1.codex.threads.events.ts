import { createFileRoute } from '@tanstack/react-router';
import { getCodexThreadEventCorsOrigin, isAllowedCodexThreadEventOrigin } from '#/lib/codex-thread-event-origin';

const MAX_LIVE_THREAD_SUBSCRIPTIONS = 64;
const jsonError = (body: unknown, status: number) =>
    Response.json(body, {
        headers: { 'X-Content-Type-Options': 'nosniff' },
        status,
    });

export const handleCodexThreadEventsRequest = async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin');
    const corsOrigin = getCodexThreadEventCorsOrigin(request.url, origin);
    const withCors = (response: Response) => {
        if (corsOrigin) {
            response.headers.set('Access-Control-Allow-Origin', corsOrigin);
            response.headers.set('Vary', 'Origin');
        }
        return response;
    };

    if (!isAllowedCodexThreadEventOrigin(request.url, origin)) {
        return withCors(jsonError({ error: 'Live thread events only accept the app loopback origin.' }, 403));
    }

    const threadIds = [
        ...new Set(
            new URL(request.url).searchParams
                .getAll('threadId')
                .map((threadId) => threadId.trim())
                .filter(Boolean),
        ),
    ];
    if (threadIds.length === 0 || threadIds.length > MAX_LIVE_THREAD_SUBSCRIPTIONS) {
        return withCors(
            jsonError({ error: `Provide between 1 and ${MAX_LIVE_THREAD_SUBSCRIPTIONS} threadId parameters.` }, 400),
        );
    }

    const [
        { CodexThreadNotFoundError, resolveCodexThreadDbPath },
        { getThreadBrowseData },
        { createCodexThreadEventResponse },
    ] = await Promise.all([
        import('@spiracha/lib/codex-database'),
        import('@spiracha/lib/codex-browser-queries'),
        import('@spiracha/lib/codex-thread-events'),
    ]);
    const dbPath = process.env.SPIRACHA_CODEX_DB?.trim() || resolveCodexThreadDbPath();

    try {
        const threads = threadIds.map((threadId) => ({
            rolloutPath: getThreadBrowseData(dbPath, threadId).thread.rollout_path,
            threadId,
        }));
        const response = createCodexThreadEventResponse({
            signal: request.signal,
            threads,
        });
        if (corsOrigin) {
            response.headers.set('Access-Control-Allow-Origin', corsOrigin);
            response.headers.set('Vary', 'Origin');
        }
        return response;
    } catch (error) {
        if (error instanceof CodexThreadNotFoundError) {
            return withCors(jsonError({ error: error.message }, 404));
        }
        throw error;
    }
};

export const Route = createFileRoute('/api/v1/codex/threads/events')({
    server: {
        handlers: {
            GET: ({ request }) => handleCodexThreadEventsRequest(request),
        },
    },
});
