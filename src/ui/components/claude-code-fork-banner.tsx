import type { ClaudeCodeSessionFork } from '@spiracha/lib/claude-code-exporter-types';
import { Link } from '@tanstack/react-router';
import { GitFork } from 'lucide-react';
import { Fragment } from 'react';

type ClaudeCodeForkBannerProps = {
    forkSessionIds: string[];
    forkedFrom: ClaudeCodeSessionFork | null;
};

const SessionLink = ({ sessionId }: { sessionId: string }) => (
    <Link
        className="font-mono text-[var(--accent)] underline-offset-2 hover:underline"
        params={{ sessionId }}
        to="/claude-code-sessions/$sessionId"
    >
        {sessionId}
    </Link>
);

export const ClaudeCodeForkBanner = ({ forkSessionIds, forkedFrom }: ClaudeCodeForkBannerProps) => {
    if (!forkedFrom && forkSessionIds.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
            {forkSessionIds.length > 0 ? (
                <p className="flex flex-wrap items-center gap-2">
                    <GitFork aria-hidden="true" className="size-4 text-[var(--muted-foreground)]" />
                    <span>Rewound into a newer branch:</span>
                    {forkSessionIds.map((sessionId, index) => (
                        <Fragment key={sessionId}>
                            {index > 0 ? ', ' : null}
                            <SessionLink sessionId={sessionId} />
                        </Fragment>
                    ))}
                </p>
            ) : null}
            {forkedFrom ? (
                <p className="flex flex-wrap items-center gap-2">
                    <GitFork aria-hidden="true" className="size-4 text-[var(--muted-foreground)]" />
                    <span>Branched from an earlier version:</span>
                    <SessionLink sessionId={forkedFrom.sessionId} />
                </p>
            ) : null}
        </div>
    );
};
