import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/v1/conversations/$source/$id')({
    server: {
        handlers: {
            DELETE: async ({ request }) => {
                const { handleConversationApiRequest } = await import('@spiracha/lib/conversation-api');
                return handleConversationApiRequest(request);
            },
            GET: async ({ request }) => {
                const { handleConversationApiRequest } = await import('@spiracha/lib/conversation-api');
                return handleConversationApiRequest(request);
            },
        },
    },
});
