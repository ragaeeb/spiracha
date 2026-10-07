import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchToolCallsFnMock } = vi.hoisted(() => ({ searchToolCallsFnMock: vi.fn() }));

vi.mock('./tool-call-search-server', () => ({ searchToolCallsFn: searchToolCallsFnMock }));

import { useToolCallSearch } from './use-tool-call-search';

const result = {
    failedCount: 0,
    hits: [
        { conversationId: 'a', likelyAuthor: true, matchCount: 2, matches: [], title: 'A', updatedAtMs: 2 },
        { conversationId: 'b', likelyAuthor: false, matchCount: 1, matches: [], title: 'B', updatedAtMs: 1 },
    ],
    scannedCount: 5,
};

beforeEach(() => {
    searchToolCallsFnMock.mockReset();
    searchToolCallsFnMock.mockResolvedValue(result);
});

describe('useToolCallSearch', () => {
    it('should search the workspace paths for the trimmed query and expose hits by thread id', async () => {
        const { result: hook } = renderHook(() => useToolCallSearch({ cwds: ['/repo'], source: 'cursor' }));

        act(() => hook.current.setQuery('  file.test.ts  '));
        act(() => {
            void hook.current.run();
        });

        await waitFor(() => expect(hook.current.hitsById?.size).toBe(2));
        expect(searchToolCallsFnMock).toHaveBeenCalledWith({
            data: { cwds: ['/repo'], query: 'file.test.ts', source: 'cursor' },
        });
        expect(hook.current.hitsById?.get('a')?.likelyAuthor).toBe(true);
        expect(hook.current.summary).toEqual({ likelyAuthorCount: 1, scannedCount: 5, threadCount: 2 });
    });

    it('should not search for a query that is too short', async () => {
        const { result: hook } = renderHook(() => useToolCallSearch({ cwds: ['/repo'], source: 'codex' }));

        act(() => hook.current.setQuery('a'));
        await act(async () => {
            await hook.current.run();
        });

        expect(searchToolCallsFnMock).not.toHaveBeenCalled();
        expect(hook.current.hitsById).toBeNull();
    });

    it('should clear the active search', async () => {
        const { result: hook } = renderHook(() => useToolCallSearch({ cwds: ['/repo'], source: 'codex' }));
        act(() => hook.current.setQuery('needle'));
        await act(async () => {
            await hook.current.run();
        });
        expect(hook.current.hitsById).not.toBeNull();

        act(() => hook.current.clear());

        expect(hook.current.hitsById).toBeNull();
        expect(hook.current.query).toBe('');
    });

    it('should surface a failed search without keeping stale hits', async () => {
        searchToolCallsFnMock.mockRejectedValueOnce(new Error('boom'));
        const { result: hook } = renderHook(() => useToolCallSearch({ cwds: ['/repo'], source: 'codex' }));
        act(() => hook.current.setQuery('needle'));

        await act(async () => {
            await hook.current.run();
        });

        expect(hook.current.error).toBe('boom');
        expect(hook.current.hitsById).toBeNull();
    });

    it('should explain when the workspace has no folder path to search', async () => {
        const { result: hook } = renderHook(() => useToolCallSearch({ cwds: [], source: 'antigravity' }));
        act(() => hook.current.setQuery('needle'));

        await act(async () => {
            await hook.current.run();
        });

        expect(searchToolCallsFnMock).not.toHaveBeenCalled();
        expect(hook.current.error).toBe('This workspace has no folder path, so its tool calls cannot be searched.');
    });
});
