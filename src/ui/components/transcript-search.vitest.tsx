import type { ThreadEvent } from '@spiracha/lib/codex-browser-types';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildTranscriptSearchResults,
    TranscriptSearchPanel,
    type TranscriptSearchResult,
    useTranscriptSearchNavigation,
} from './transcript-search';

const message = (
    sequence: number,
    text: string,
    role: 'assistant' | 'user',
): Extract<ThreadEvent, { kind: 'message' }> => ({
    isHiddenByDefault: false,
    kind: 'message',
    memoryCitation: null,
    model: role === 'assistant' ? 'claude-sonnet-4-6' : null,
    phase: role === 'assistant' ? 'final_answer' : null,
    raw: { type: 'message' },
    role,
    sequence,
    text,
    timestamp: `2026-07-24T12:00:0${sequence}.000Z`,
    variant: 'message',
});

afterEach(cleanup);

describe('transcript search', () => {
    it('should find visible Claude Code transcript messages after applying text transforms', () => {
        const results = buildTranscriptSearchResults(
            [message(0, 'Update /Users/example/workspace/app/src/index.ts', 'assistant'), message(1, 'Done', 'user')],
            'PROJECT_ROOT/src',
            'claude-sonnet-4-6',
            {
                showCommentary: false,
                showExtraEvents: false,
                showToolCalls: false,
                showUserMessages: true,
            },
            (text) => text.replace('/Users/example/workspace/app', 'PROJECT_ROOT'),
        );

        expect(results).toMatchObject([
            {
                eventIndex: 0,
                messageNumber: 1,
                roleLabel: 'Claude Sonnet 4.6',
                snippet: 'Update PROJECT_ROOT/src/index.ts',
            },
        ]);
    });

    it('should expose search navigation with accessible controls', () => {
        const onJumpToResult = vi.fn();
        const onQueryChange = vi.fn();
        const results: TranscriptSearchResult[] = [
            {
                event: message(0, 'First matching message', 'assistant'),
                eventIndex: 0,
                eventKey: 'message-0',
                messageNumber: 1,
                phase: 'final_answer',
                roleLabel: 'Claude Sonnet 4.6',
                snippet: 'First matching message',
            },
        ];

        render(
            <TranscriptSearchPanel
                activeResultIndex={0}
                query="matching"
                results={results}
                onJumpToResult={onJumpToResult}
                onQueryChange={onQueryChange}
            />,
        );

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search transcript messages' }), {
            target: { value: 'updated' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Next search result' }));

        expect(onQueryChange).toHaveBeenCalledWith('updated');
        expect(onJumpToResult).toHaveBeenCalledWith(1);
        expect(screen.getByText('1 / 1')).toBeTruthy();
    });

    it('should wrap search navigation and reset the active result when matches change', () => {
        const firstResult: TranscriptSearchResult = {
            event: message(0, 'First matching message', 'assistant'),
            eventIndex: 0,
            eventKey: 'message-0',
            messageNumber: 1,
            phase: 'final_answer',
            roleLabel: 'Claude Sonnet 4.6',
            snippet: 'First matching message',
        };
        const secondResult: TranscriptSearchResult = {
            ...firstResult,
            event: message(1, 'Second matching message', 'assistant'),
            eventIndex: 1,
            eventKey: 'message-1',
            messageNumber: 2,
            snippet: 'Second matching message',
        };
        const { result, rerender } = renderHook(
            ({ results }: { results: TranscriptSearchResult[] }) => useTranscriptSearchNavigation(results),
            { initialProps: { results: [firstResult, secondResult] } },
        );

        act(() => result.current.jumpToResult(-1));
        expect(result.current).toMatchObject({
            activeEventKey: 'message-1',
            activeResultIndex: 1,
            jumpSignal: 1,
        });

        rerender({ results: [firstResult] });
        expect(result.current).toMatchObject({
            activeEventKey: null,
            activeResultIndex: 0,
        });
    });
});
