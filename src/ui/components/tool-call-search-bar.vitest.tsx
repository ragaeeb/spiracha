import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallSearchState } from '#/lib/use-tool-call-search';
import { ToolCallSearchBar } from './tool-call-search-bar';

afterEach(() => {
    cleanup();
});

const state = (overrides: Partial<ToolCallSearchState> = {}): ToolCallSearchState => ({
    clear: vi.fn(),
    error: null,
    hitsById: null,
    isPending: false,
    query: '',
    run: vi.fn(async () => {}),
    setQuery: vi.fn(),
    summary: null,
    ...overrides,
});

describe('ToolCallSearchBar', () => {
    it('should run the search when the form is submitted', () => {
        const search = state({ query: 'file.test.ts' });
        render(<ToolCallSearchBar search={search} />);

        fireEvent.click(screen.getByRole('button', { name: 'Search tool calls' }));

        expect(search.run).toHaveBeenCalledTimes(1);
    });

    it('should report how many threads matched and how many likely wrote the file', () => {
        render(
            <ToolCallSearchBar
                search={state({
                    hitsById: new Map(),
                    query: 'file.test.ts',
                    summary: { likelyAuthorCount: 1, scannedCount: 40, threadCount: 3 },
                })}
            />,
        );

        expect(screen.getByText('3 of 40 threads matched · 1 likely wrote it')).toBeTruthy();
    });

    it('should let the user clear an active search', () => {
        const search = state({
            hitsById: new Map(),
            summary: { likelyAuthorCount: 0, scannedCount: 4, threadCount: 0 },
        });
        render(<ToolCallSearchBar search={search} />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

        expect(search.clear).toHaveBeenCalledTimes(1);
    });

    it('should show progress and errors', () => {
        const { rerender } = render(<ToolCallSearchBar search={state({ isPending: true, query: 'needle' })} />);
        expect(screen.getByText('Searching tool calls…')).toBeTruthy();

        rerender(<ToolCallSearchBar search={state({ error: 'boom' })} />);
        expect(screen.getByText('boom')).toBeTruthy();
    });
});
