import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchConversationToolCallsMock } = vi.hoisted(() => ({ searchConversationToolCallsMock: vi.fn() }));

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        const serverFn = {
            handler: (callback: unknown) => callback,
            validator: () => serverFn,
        };

        return serverFn;
    },
}));

vi.mock('@spiracha/lib/conversation-data/tool-call-search', () => ({
    searchConversationToolCalls: searchConversationToolCallsMock,
}));

import { searchToolCallsFn, toSearchCwd, WORKSPACE_SEARCH_SOURCES } from './tool-call-search-server';

type SearchHandler = (input: { data: { cwds: string[]; query: string; source: string } }) => Promise<unknown>;

beforeEach(() => {
    searchConversationToolCallsMock.mockReset();
    searchConversationToolCallsMock.mockResolvedValue({ failedCount: 0, hits: [], scannedCount: 0 });
});

describe('tool call search server function', () => {
    it('should search every requested workspace path for the source', async () => {
        await (searchToolCallsFn as unknown as SearchHandler)({
            data: { cwds: ['/work/a', '/work/b'], query: 'needle.ts', source: 'codex' },
        });

        expect(searchConversationToolCallsMock).toHaveBeenCalledWith({
            cwds: ['/work/a', '/work/b'],
            query: 'needle.ts',
            source: 'codex',
        });
    });

    it('should convert file URIs from Antigravity and Cursor workspaces into paths', () => {
        expect(toSearchCwd('file:///Users/me/My%20Project')).toBe('/Users/me/My Project');
        expect(toSearchCwd('/Users/me/plain')).toBe('/Users/me/plain');
    });

    it('should offer exactly the workspace-scoped sources', () => {
        expect([...WORKSPACE_SEARCH_SOURCES].sort()).toEqual([
            'antigravity',
            'claude-code',
            'cline',
            'codex',
            'command-code',
            'cursor',
            'fx',
            'grok',
            'kiro',
            'minimax-code',
            'opencode',
            'qoder',
        ]);
    });
});
