import { Search } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import type { ToolCallSearchState } from '#/lib/use-tool-call-search';

type ToolCallSearchBarProps = {
    search: ToolCallSearchState;
};

const describeSummary = ({
    likelyAuthorCount,
    scannedCount,
    threadCount,
}: NonNullable<ToolCallSearchState['summary']>) =>
    `${threadCount} of ${scannedCount} threads matched${likelyAuthorCount > 0 ? ` · ${likelyAuthorCount} likely wrote it` : ''}`;

/** Searches inside threads' tool calls, e.g. to find which thread touched a file left dirty in the worktree. */
export const ToolCallSearchBar = ({ search }: ToolCallSearchBarProps) => (
    <form
        className="space-y-2"
        onSubmit={(event) => {
            event.preventDefault();
            void search.run();
        }}
    >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
                aria-label="Search tool calls"
                className="h-10 w-full rounded-full border-[var(--border)] bg-[var(--panel)] px-4 sm:w-[28rem]"
                placeholder="Search tool calls for a file path or command"
                value={search.query}
                onChange={(event) => search.setQuery(event.target.value)}
            />
            <Button className="rounded-full" disabled={search.isPending} type="submit" variant="outline">
                <Search className="mr-2 size-4" />
                Search tool calls
            </Button>
            {search.hitsById ? (
                <Button className="rounded-full" type="button" variant="ghost" onClick={search.clear}>
                    Clear
                </Button>
            ) : null}
        </div>
        {search.isPending ? (
            <p className="text-[var(--muted-foreground)] text-sm">Searching tool calls…</p>
        ) : search.error ? (
            <p className="text-[var(--destructive)] text-sm">{search.error}</p>
        ) : search.summary ? (
            <p className="text-[var(--muted-foreground)] text-sm">{describeSummary(search.summary)}</p>
        ) : null}
    </form>
);
