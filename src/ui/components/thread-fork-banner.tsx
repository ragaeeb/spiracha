import type { ThreadForkInfo } from '@spiracha/lib/codex-browser-types';
import { Link } from '@tanstack/react-router';
import { GitBranch } from 'lucide-react';

export type ThreadForkBannerInfo = ThreadForkInfo & { parentTitle: string | null };

/** Tells a reader that a Codex thread was forked from another one, and what is missing if that parent is gone. */
export const ThreadForkBanner = ({ fork }: { fork: ThreadForkBannerInfo | null }) => {
    if (!fork) {
        return null;
    }

    return (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm">
            <GitBranch aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
            {fork.parentAvailable ? (
                <p>
                    This thread is a fork of{' '}
                    <Link
                        className="text-[var(--accent)] underline-offset-2 hover:underline"
                        params={{ threadId: fork.parentThreadId }}
                        to="/threads/$threadId"
                    >
                        {fork.parentTitle ?? fork.parentThreadId}
                    </Link>
                    . It only stores what happened after the fork and borrows the earlier history from that thread.
                </p>
            ) : (
                <p>
                    This thread was forked from thread {fork.parentThreadId}, which no longer exists, so its earlier
                    history is gone. Export includes the conversation after the fork.
                </p>
            )}
        </div>
    );
};
