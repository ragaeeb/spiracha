import type { MessageEvent, ThreadEvent } from '@spiracha/lib/codex-browser-types';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { getTranscriptEventKey, shouldShowEvent } from '#/components/transcript-view';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { formatModelLabel } from '#/lib/formatters';

export type TranscriptSearchResult = {
    event: MessageEvent;
    eventIndex: number;
    eventKey: string;
    messageNumber: number;
    phase: string | null;
    roleLabel: string;
    snippet: string;
};

export type TranscriptSearchFilters = {
    showCommentary: boolean;
    showExtraEvents: boolean;
    showToolCalls: boolean;
    showUserMessages: boolean;
};

type TranscriptSearchPanelProps = {
    activeResultIndex: number;
    query: string;
    results: TranscriptSearchResult[];
    onJumpToResult: (index: number) => void;
    onQueryChange: (value: string) => void;
};

const SEARCH_SNIPPET_RADIUS = 72;

const normalizeTranscriptSearchText = (value: string) => value.replace(/\s+/gu, ' ').trim();

const getTranscriptSearchRoleLabel = (event: MessageEvent, assistantModel: string | null) => {
    if (event.role === 'assistant') {
        return formatModelLabel(event.model ?? assistantModel);
    }

    return event.role === 'system' ? 'System' : 'User';
};

const buildTranscriptSearchSnippet = (text: string, query: string) => {
    const normalizedText = normalizeTranscriptSearchText(text);
    const normalizedQuery = normalizeTranscriptSearchText(query).toLowerCase();
    const matchIndex = normalizedText.toLowerCase().indexOf(normalizedQuery);

    if (matchIndex < 0) {
        return normalizedText.slice(0, SEARCH_SNIPPET_RADIUS * 2);
    }

    const start = Math.max(0, matchIndex - SEARCH_SNIPPET_RADIUS);
    const end = Math.min(normalizedText.length, matchIndex + normalizedQuery.length + SEARCH_SNIPPET_RADIUS);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < normalizedText.length ? '...' : '';

    return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
};

export const buildTranscriptSearchResults = (
    events: ThreadEvent[],
    query: string,
    assistantModel: string | null,
    filters: TranscriptSearchFilters,
    transform: (text: string) => string,
): TranscriptSearchResult[] => {
    const normalizedQuery = normalizeTranscriptSearchText(query).toLowerCase();
    if (!normalizedQuery) {
        return [];
    }

    const results: TranscriptSearchResult[] = [];
    let messageNumber = 0;

    events.forEach((event, index) => {
        if (event.kind !== 'message') {
            return;
        }

        if (
            !shouldShowEvent(
                event,
                filters.showToolCalls,
                filters.showExtraEvents,
                filters.showCommentary,
                filters.showUserMessages,
            )
        ) {
            return;
        }

        messageNumber += 1;
        const searchText = normalizeTranscriptSearchText(transform(event.text));
        if (!searchText.toLowerCase().includes(normalizedQuery)) {
            return;
        }

        results.push({
            event,
            eventIndex: index,
            eventKey: getTranscriptEventKey(event, index),
            messageNumber,
            phase: event.phase,
            roleLabel: getTranscriptSearchRoleLabel(event, assistantModel),
            snippet: buildTranscriptSearchSnippet(searchText, query),
        });
    });

    return results;
};

export const useTranscriptSearchNavigation = (results: TranscriptSearchResult[]) => {
    const [activeResultIndex, setActiveResultIndex] = useState(0);
    const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
    const [jumpSignal, setJumpSignal] = useState(0);

    useEffect(() => {
        setActiveResultIndex((current) => (results.length === 0 ? 0 : Math.min(current, results.length - 1)));
        setActiveEventKey((current) =>
            current && results.some((result) => result.eventKey === current) ? current : null,
        );
    }, [results]);

    const reset = () => {
        setActiveResultIndex(0);
        setActiveEventKey(null);
    };

    const jumpToResult = (index: number) => {
        if (results.length === 0) {
            return;
        }

        const wrappedIndex = ((index % results.length) + results.length) % results.length;
        setActiveResultIndex(wrappedIndex);
        setActiveEventKey(results[wrappedIndex]!.eventKey);
        setJumpSignal((current) => current + 1);
    };

    return {
        activeEventKey,
        activeResultIndex,
        jumpSignal,
        jumpToResult,
        reset,
    };
};

export const TranscriptSearchPanel = ({
    activeResultIndex,
    query,
    results,
    onJumpToResult,
    onQueryChange,
}: TranscriptSearchPanelProps) => {
    const hasQuery = normalizeTranscriptSearchText(query).length > 0;
    const hasResults = results.length > 0;
    const statusLabel = hasQuery
        ? hasResults
            ? `${activeResultIndex + 1} / ${results.length}`
            : 'No matches'
        : 'Search';

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || !hasResults) {
            return;
        }

        event.preventDefault();
        onJumpToResult(event.shiftKey ? activeResultIndex - 1 : activeResultIndex);
    };

    return (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-[var(--panel-shadow)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                    <Input
                        aria-label="Search transcript messages"
                        className="h-10 rounded-full border-[var(--border)] bg-[var(--panel-secondary)] pr-4 pl-9"
                        placeholder="Search transcript messages"
                        type="search"
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-20 text-right text-[var(--muted-foreground)] text-sm">{statusLabel}</span>
                    <Button
                        aria-label="Previous search result"
                        className="rounded-full"
                        disabled={!hasResults}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => onJumpToResult(activeResultIndex - 1)}
                    >
                        <ChevronUp className="size-4" />
                        Prev
                    </Button>
                    <Button
                        aria-label="Next search result"
                        className="rounded-full"
                        disabled={!hasResults}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => onJumpToResult(activeResultIndex + 1)}
                    >
                        <ChevronDown className="size-4" />
                        Next
                    </Button>
                </div>
            </div>

            {hasQuery && hasResults ? (
                <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel-secondary)]">
                    {results.map((result, index) => (
                        <button
                            key={result.eventKey}
                            aria-current={index === activeResultIndex ? 'true' : undefined}
                            className="block w-full border-[var(--border)] border-b px-3 py-2.5 text-left transition last:border-b-0 hover:bg-[var(--panel)] aria-current:bg-[var(--panel)]"
                            type="button"
                            onClick={() => onJumpToResult(index)}
                        >
                            <span className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-sm">Message {result.messageNumber}</span>
                                <Badge variant="outline">{result.roleLabel}</Badge>
                                {result.phase ? <Badge variant="outline">{result.phase}</Badge> : null}
                            </span>
                            <span className="mt-1 block min-w-0 break-words text-[var(--muted-foreground)] text-sm leading-5 [overflow-wrap:anywhere]">
                                {result.snippet}
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}
        </section>
    );
};
