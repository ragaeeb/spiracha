import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/v1/codex/threads/$threadId/events')({
    server: {
        handlers: {
            GET: async ({ params, request }) => {
                const [
                    { CodexThreadNotFoundError, getThreadBrowseData, resolveCodexThreadDbPath },
                    { createCodexThreadEventResponse },
                ] = await Promise.all([
                    import('@spiracha/lib/codex-browser-db'),
                    import('@spiracha/lib/codex-thread-events'),
                ]);
                const dbPath = process.env.SPIRACHA_CODEX_DB?.trim() || resolveCodexThreadDbPath();

                try {
                    const browseData = getThreadBrowseData(dbPath, params.threadId);
                    return createCodexThreadEventResponse({
                        rolloutPath: browseData.thread.rollout_path,
                        signal: request.signal,
                    });
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
