import { GitFork } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '#/lib/utils';
import { useToolCallHit } from './tool-call-hits-context';
import { ToolCallMatchSummary } from './tool-call-match-summary';

type ConversationTitleCellProps = {
    badges?: ReactNode;
    depth?: number;
    footer?: ReactNode;
    id: string;
    isNestedAgent?: boolean;
    renderLink: (content: ReactNode, className: string) => ReactNode;
    title: string;
};

const CONVERSATION_LINK_CLASS =
    'block min-w-0 max-w-[24rem] flex-1 space-y-1 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--accent)]';

/**
 * Shared title column for every source's conversation list so the title, the id line, and
 * nested-row styling stay identical across integrations. Each table supplies its own typed
 * router link through `renderLink`.
 */
export const ConversationTitleCell = ({
    badges,
    depth = 0,
    footer,
    id,
    isNestedAgent = false,
    renderLink,
    title,
}: ConversationTitleCellProps) => {
    const isNested = depth > 0;
    const toolCallHit = useToolCallHit(id);

    return (
        <div
            className={cn('min-w-0', isNested ? 'border-[var(--border)] border-l-2' : '')}
            data-row-depth={depth}
            style={isNested ? { paddingLeft: `${depth * 0.75}rem` } : undefined}
        >
            <div className="flex min-w-0 items-center gap-2">
                {isNestedAgent ? (
                    <GitFork aria-hidden="true" className="size-4 shrink-0 text-[var(--muted-foreground)]" />
                ) : null}
                {renderLink(
                    <>
                        <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate font-medium underline-offset-2 hover:underline">{title}</p>
                            {badges}
                        </div>
                        <p className="truncate text-[var(--muted-foreground)] text-xs">{id}</p>
                    </>,
                    CONVERSATION_LINK_CLASS,
                )}
            </div>
            {footer}
            {toolCallHit ? <ToolCallMatchSummary hit={toolCallHit} /> : null}
        </div>
    );
};
