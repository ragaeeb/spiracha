import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/v1/conversation-query')({
    server: {
        handlers: {
            POST: async ({ request }) => {
                const { handleConversationApiRequest } = await import('@spiracha/lib/conversation-api');
                return handleConversationApiRequest(request);
            },
        },
    },
});
