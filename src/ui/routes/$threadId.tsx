import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { isCodexThreadId } from '#/lib/thread-id';

export const Route = createFileRoute('/$threadId')({
    beforeLoad: ({ params }) => {
        if (!isCodexThreadId(params.threadId)) {
            throw notFound();
        }

        throw redirect({
            params: {
                threadId: params.threadId,
            },
            to: '/threads/$threadId',
        });
    },
    component: ThreadShortcutRedirectPage,
});

function ThreadShortcutRedirectPage() {
    return null;
}
