import type { ToolCallSearchHit, ToolCallSearchResult } from '@spiracha/lib/conversation-data/tool-call-search';
import { useCallback, useMemo, useRef, useState } from 'react';
import { searchToolCallsFn, type WORKSPACE_SEARCH_SOURCES } from './tool-call-search-server';

const MIN_QUERY_LENGTH = 2;

type ToolCallSearchSummary = {
    likelyAuthorCount: number;
    scannedCount: number;
    threadCount: number;
};

export type ToolCallSearchState = {
    clear: () => void;
    error: string | null;
    hitsById: ReadonlyMap<string, ToolCallSearchHit> | null;
    isPending: boolean;
    query: string;
    run: () => Promise<void>;
    setQuery: (query: string) => void;
    summary: ToolCallSearchSummary | null;
};

type ToolCallSearchInput = {
    cwds: string[];
    source: (typeof WORKSPACE_SEARCH_SOURCES)[number];
};

type SearchState = {
    error: string | null;
    isPending: boolean;
    result: ToolCallSearchResult | null;
};

const IDLE: SearchState = { error: null, isPending: false, result: null };
const NO_PATH_ERROR = 'This workspace has no folder path, so its tool calls cannot be searched.';

/** Explicit (submit-driven) tool call search over the threads of one workspace. */
export const useToolCallSearch = ({ cwds, source }: ToolCallSearchInput): ToolCallSearchState => {
    const [query, setQuery] = useState('');
    const [{ error, isPending, result }, setState] = useState<SearchState>(IDLE);
    const latestRequest = useRef(0);

    const run = useCallback(async () => {
        const trimmed = query.trim();
        if (trimmed.length < MIN_QUERY_LENGTH) {
            return;
        }
        if (cwds.length === 0) {
            setState({ ...IDLE, error: NO_PATH_ERROR });
            return;
        }

        latestRequest.current += 1;
        const requestId = latestRequest.current;
        // Ignore answers to searches the user has since replaced or cleared.
        const settle = (next: SearchState) => {
            if (latestRequest.current === requestId) {
                setState(next);
            }
        };
        setState((previous) => ({ ...previous, error: null, isPending: true }));
        try {
            settle({ ...IDLE, result: await searchToolCallsFn({ data: { cwds, query: trimmed, source } }) });
        } catch (searchError) {
            settle({ ...IDLE, error: searchError instanceof Error ? searchError.message : 'Tool call search failed' });
        }
    }, [cwds, query, source]);

    const clear = useCallback(() => {
        latestRequest.current += 1;
        setQuery('');
        setState(IDLE);
    }, []);

    const hitsById = useMemo(
        () => (result ? new Map(result.hits.map((hit) => [hit.conversationId, hit])) : null),
        [result],
    );
    const summary = useMemo(
        () =>
            result
                ? {
                      likelyAuthorCount: result.hits.filter((hit) => hit.likelyAuthor).length,
                      scannedCount: result.scannedCount,
                      threadCount: result.hits.length,
                  }
                : null,
        [result],
    );

    return { clear, error, hitsById, isPending, query, run, setQuery, summary };
};
