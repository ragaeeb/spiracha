import { CONVERSATION_SOURCES } from '@spiracha/lib/conversation-data/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        const serverFn = {
            handler: (callback: unknown) => callback,
            validator: () => serverFn,
        };
        return serverFn;
    },
}));

import {
    invalidateSourceConversationQueries,
    SOURCE_QUERY_BINDINGS,
    SOURCE_QUERY_SURFACES,
    sourceConversationQueryKeys,
} from './source-query-bindings';

describe('source query invalidation bindings', () => {
    it('should register every local source plus Web and Cloud surfaces', () => {
        expect([...SOURCE_QUERY_SURFACES].sort()).toEqual([...CONVERSATION_SOURCES, 'codex-cloud', 'web'].sort());
        expect(Object.keys(SOURCE_QUERY_BINDINGS).sort()).toEqual([...SOURCE_QUERY_SURFACES].sort());
    });

    it('should bind Grok Bot to global chat keys without inventing a workspace', () => {
        expect(sourceConversationQueryKeys('grok-bot', { ids: ['chat-1'], workspaceKey: 'ignored' })).toEqual({
            invalidate: [['grok-bot-chats'], ['grok-bot-chat', 'chat-1']],
            remove: [['grok-bot-chat', 'chat-1']],
        });
    });

    it('should bind Command Code workspaces, lists, and session details', () => {
        expect(sourceConversationQueryKeys('command-code', { ids: ['session-1'], workspaceKey: 'ws' })).toEqual({
            invalidate: [
                ['command-code-workspaces'],
                ['command-code-sessions', 'ws'],
                ['command-code-session', 'session-1'],
            ],
            remove: [['command-code-session', 'session-1']],
        });
    });

    it('should include Cursor and Claude Code deferred transcript bodies', () => {
        expect(sourceConversationQueryKeys('cursor', { ids: ['thread-1'], workspaceKey: 'ws' }).invalidate).toEqual([
            ['cursor-workspaces'],
            ['cursor-threads', 'ws'],
            ['cursor-thread', 'thread-1'],
            ['cursor-thread-transcript', 'thread-1'],
        ]);
        expect(
            sourceConversationQueryKeys('claude-code', { ids: ['session-1'], workspaceKey: 'ws' }).invalidate,
        ).toContainEqual(['claude-code-session-transcript', 'session-1']);
    });

    it('should keep Web artifact keys on imported ids and Cloud keys off CONVERSATION_SOURCES', () => {
        expect(CONVERSATION_SOURCES).not.toContain('web');
        expect(CONVERSATION_SOURCES).not.toContain('codex-cloud');
        expect(sourceConversationQueryKeys('web', { ids: ['parsed-id'] }).invalidate).toEqual([
            ['web-chats'],
            ['web-chat', 'parsed-id'],
            ['web-chat-events', 'parsed-id'],
            ['web-chat-artifacts', 'parsed-id'],
        ]);
        expect(
            sourceConversationQueryKeys('codex-cloud', {
                ids: ['task_e_1'],
                workspaceKey: 'label:owner',
            }).invalidate,
        ).toEqual([['codex-cloud-projects'], ['codex-cloud-project', 'label:owner'], ['codex-cloud-task', 'task_e_1']]);
    });

    it('should refresh only Codex thread bodies for live transcript updates', () => {
        expect(sourceConversationQueryKeys('codex', { ids: ['thread-1'], scope: 'detail' }).invalidate).toEqual([
            ['thread', 'thread-1'],
            ['thread-transcript-preview', 'thread-1'],
            ['thread-transcript', 'thread-1'],
        ]);
    });

    it('should invalidate Codex inventory, project list, analytics, and deferred bodies', () => {
        expect(sourceConversationQueryKeys('codex', { ids: ['thread-1'], workspaceKey: 'proj' }).invalidate).toEqual([
            ['projects'],
            ['project-threads', 'proj'],
            ['dashboard'],
            ['analytics', 'proj'],
            ['analytics', 'all'],
            ['thread', 'thread-1'],
            ['thread-transcript-preview', 'thread-1'],
            ['thread-transcript', 'thread-1'],
        ]);
    });

    it('should remove stale detail bodies after a successful delete', async () => {
        const invalidateQueries = vi.fn().mockResolvedValue(undefined);
        const removeQueries = vi.fn();

        await invalidateSourceConversationQueries({ invalidateQueries, removeQueries }, 'command-code', {
            ids: ['session-1'],
            removeDetails: true,
            workspaceKey: 'ws',
        });

        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['command-code-workspaces'] });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['command-code-sessions', 'ws'] });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['command-code-session', 'session-1'] });
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['command-code-session', 'session-1'] });
    });
});
