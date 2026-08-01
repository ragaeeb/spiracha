import { createFileRoute } from '@tanstack/react-router';
import { isAllowedCodexThreadEventOrigin } from '#/lib/codex-thread-event-origin';

const MAX_LIVE_THREAD_SUBSCRIPTIONS = 64;

export const Route = createFileRoute('/api/v1/codex/threads/events')({
    server: {
        handlers: {
            GET: async ({ request }) => {
                if (!isAllowedCodexThreadEventOrigin(request.url, request.headers.get('Origin'))) {
                    return Response.json(
                        { error: 'Live thread events only accept the app loopback origin.' },
                        { status: 403 },
                    );
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
                    return Response.json(
                        { error: `Provide between 1 and ${MAX_LIVE_THREAD_SUBSCRIPTIONS} threadId parameters.` },
                        { status: 400 },
                    );
                }

                const [
                    { CodexThreadNotFoundError, getThreadBrowseData, resolveCodexThreadDbPath },
                    { createCodexThreadEventResponse },
                ] = await Promise.all([
                    import('@spiracha/lib/codex-browser-db'),
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
                    const origin = request.headers.get('Origin');
                    if (origin) {
                        response.headers.set('Access-Control-Allow-Origin', origin);
                        response.headers.append('Vary', 'Origin');
                    }
                    return response;
                } catch (error) {
                    if (error instanceof CodexThreadNotFoundError) {
                        return Response.json({ error: error.message }, { status: 404 });
                    }
                    throw error;
                }
            },
        },
    },
});
