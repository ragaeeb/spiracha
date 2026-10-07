import type { ToolCallSearchHit } from '@spiracha/lib/conversation-data/tool-call-search';
import { Badge } from '#/components/ui/badge';

type ToolCallMatchSummaryProps = {
    hit: ToolCallSearchHit;
};

/** Which tool calls in a thread mention the searched text, with writes flagged as the likely cause. */
export const ToolCallMatchSummary = ({ hit }: ToolCallMatchSummaryProps) => (
    <div className="mt-2 space-y-1 border-[var(--border)] border-l-2 pl-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
            {hit.likelyAuthor ? <Badge variant="secondary">Likely author</Badge> : null}
            {hit.matchCount > hit.matches.length ? (
                <span className="text-[var(--muted-foreground)]">
                    {hit.matchCount} matches · showing {hit.matches.length}
                </span>
            ) : null}
        </div>
        <ul className="space-y-1">
            {hit.matches.map((match) => (
                <li className="flex min-w-0 gap-2" key={`${match.messageId}:${match.field}`}>
                    <span className="shrink-0 font-medium">{match.toolName}</span>
                    <span className="truncate font-mono text-[var(--muted-foreground)]">{match.snippet}</span>
                </li>
            ))}
        </ul>
    </div>
);
