import type { ConversationDetail, ConversationMessage } from '@spiracha/lib/conversation-data/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteConversationMock, getConversationMock, listConversationsMock, renderSourceSessionDownloadMock } =
    vi.hoisted(() => ({
        deleteConversationMock: vi.fn(),
        getConversationMock: vi.fn(),
        listConversationsMock: vi.fn(),
        renderSourceSessionDownloadMock: vi.fn(),
    }));

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        const serverFn = {
            handler: (callback: unknown) => callback,
            validator: () => serverFn,
        };
        return serverFn;
    },
}));

vi.mock('@spiracha/lib/conversation-data', () => ({
    deleteConversation: deleteConversationMock,
    getConversation: getConversationMock,
    listConversations: listConversationsMock,
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
}));

import { deleteGrokBotChatFn, exportGrokBotChatFn, getGrokBotChatFn, listGrokBotChatsFn } from './grok-bot-server';

const message = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
    createdAtMs: 1_700_000_000_000,
    id: 'message-id',
    metadata: {},
    order: 0,
    phase: 'final_answer',
    role: 'assistant',
    text: 'answer',
    toolEvidence: null,
    ...overrides,
});

const chat = (): ConversationDetail => ({
    createdAtMs: 1_700_000_000_000,
    deepLinks: { native: null, spiracha: '/conversations/grok-bot/chat-id', ui: '/grok-bot-chats/chat-id' },
    id: 'chat-id',
    matches: [],
    messageCount: 6,
    messages: [
        message({ id: 'user', phase: 'unknown', role: 'user', text: 'Question' }),
        message({ id: 'agent', metadata: { authorName: 'Kiwi' }, text: 'Answer' }),
        message({ id: 'commentary', phase: 'commentary', text: 'Working' }),
        message({ id: 'reasoning', phase: 'reasoning', text: 'Thinking note' }),
        message({
            id: 'tool-call',
            phase: 'tool_call',
            role: 'tool',
            text: 'search',
            toolEvidence: {
                callId: 'call-1',
                command: null,
                durationMs: null,
                exitCode: null,
                inputText: '{"path":"/repo"}',
                name: 'search',
                namespace: null,
                outputText: null,
                status: 'unknown',
                workdir: null,
            },
        }),
        message({
            id: 'tool-output',
            phase: 'tool_output',
            role: 'tool',
            text: 'result',
            toolEvidence: {
                callId: 'call-1',
                command: null,
                durationMs: null,
                exitCode: 0,
                inputText: null,
                name: 'search',
                namespace: null,
                outputText: 'result',
                status: 'succeeded',
                workdir: null,
            },
        }),
    ],
    metadata: {
        attachments: [{ byteSize: 123, fileName: 'notes.md' }],
        chatKind: 'group',
        description: 'Working on the app',
        lastActivityAtMs: 1_700_000_000_050,
        members: [
            { id: 'kiwi', name: 'Kiwi' },
            { id: 'safiyyah', name: 'Safiyyah' },
        ],
        replicaPersistedAtMs: 1_700_000_000_100,
        rosterUpdatedAtMs: 1_700_000_000_075,
    },
    source: 'grok-bot',
    title: 'Bamba Dev Team',
    updatedAtMs: 1_700_000_000_100,
    workspaceKey: null,
    workspacePath: null,
});

describe('Grok Bot server operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getConversationMock.mockResolvedValue(chat());
        listConversationsMock.mockResolvedValue({ data: [chat()], meta: { hasNext: false, nextCursor: null } });
        deleteConversationMock.mockResolvedValue({ deletedFiles: ['/tmp/chat.blob'], deletedIds: ['chat-id'] });
        renderSourceSessionDownloadMock.mockResolvedValue({
            content: 'download',
            fileName: 'chat.md',
            mimeType: 'text/markdown',
            mode: 'download',
        });
    });

    it('should list, load, export, and delete a chat through the server functions', async () => {
        await expect(listGrokBotChatsFn()).resolves.toHaveLength(1);
        await expect(getGrokBotChatFn({ data: { conversationId: 'chat-id' } } as never)).resolves.toMatchObject({
            id: 'chat-id',
            source: 'grok-bot',
        });

        await exportGrokBotChatFn({
            data: {
                conversationId: 'chat-id',
                includeCommentary: true,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: false,
            },
        } as never);
        const exportRequest = renderSourceSessionDownloadMock.mock.calls[0]?.[0];
        expect(exportRequest.content).toContain('Thinking note');
        expect(exportRequest.content).toContain('Tool Call');
        expect(exportRequest.content).toContain('Bamba Dev Team');
        expect(exportRequest.content).toContain('created_at: "2023-11-14T22:13:20.000Z"');
        expect(exportRequest.content).toContain('last_activity_at: "2023-11-14T22:13:20.050Z"');
        expect(exportRequest.content).toContain('roster_updated_at: "2023-11-14T22:13:20.075Z"');
        expect(exportRequest.content).toContain('replica_persisted_at: "2023-11-14T22:13:20.100Z"');
        expect(exportRequest.content).toContain('Working on the app');
        expect(exportRequest.content).toContain('notes.md');
        expect(exportRequest.content).toContain('## Kiwi — 2023-11-14T22:13:20.000Z');

        await expect(deleteGrokBotChatFn({ data: { conversationId: 'chat-id' } } as never)).resolves.toEqual({
            deletedFiles: ['/tmp/chat.blob'],
            deletedIds: ['chat-id'],
        });
        expect(deleteConversationMock).toHaveBeenCalledWith({ id: 'chat-id', source: 'grok-bot' });
    });

    it('should omit optional export sections and reject missing chats', async () => {
        await exportGrokBotChatFn({
            data: {
                conversationId: 'chat-id',
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'txt',
                zipArchive: false,
            },
        } as never);
        const exportRequest = renderSourceSessionDownloadMock.mock.calls[0]?.[0];
        expect(exportRequest.content).not.toContain('Thinking note');
        expect(exportRequest.content).not.toContain('Tool Call');
        expect(exportRequest.content).toContain('Question');
        expect(exportRequest.content).not.toContain('2023-11-14');
        expect(exportRequest.content).not.toContain('Working on the app');

        getConversationMock.mockResolvedValueOnce(null);
        await expect(getGrokBotChatFn({ data: { conversationId: 'missing' } } as never)).rejects.toThrow(
            'Grok Bot chat not found: missing',
        );
        deleteConversationMock.mockResolvedValueOnce({ deletedFiles: [], deletedIds: [] });
        await expect(deleteGrokBotChatFn({ data: { conversationId: 'missing' } } as never)).rejects.toThrow(
            'Grok Bot chat not found: missing',
        );
    });
    it('should report residual deletion cleanup so the dialog can retry', async () => {
        deleteConversationMock.mockResolvedValue({
            cleanupFailures: [{ error: 'replica busy', path: '/fixture/replica.blob', phase: 'transcript-replica' }],
            deletedFiles: [],
            deletedIds: ['chat-id'],
        });
        await expect(deleteGrokBotChatFn({ data: { conversationId: 'chat-id' } } as never)).rejects.toThrow(
            'Roster entry removed; cleanup remains. Keep Grok Bot stopped and retry: replica busy',
        );
    });
    it('should omit unknown and invalid dates while preserving text export timestamps', async () => {
        const conversation = chat();
        conversation.createdAtMs = null;
        conversation.metadata = { chatKind: 'group', replicaPersistedAtMs: 1e20 };
        conversation.messages = [message({ createdAtMs: null }), message({ createdAtMs: 0 })];
        getConversationMock.mockResolvedValue(conversation);
        await exportGrokBotChatFn({
            data: {
                conversationId: 'chat-id',
                includeCommentary: false,
                includeMetadata: true,
                includeTools: false,
                outputFormat: 'txt',
                zipArchive: false,
            },
        } as never);
        const content = renderSourceSessionDownloadMock.mock.calls[0]?.[0].content;
        expect(content).not.toContain('created_at:');
        expect(content).not.toContain('replica_persisted_at:');
        expect(content).toContain('Assistant — 1970-01-01T00:00:00.000Z');
        expect(content).not.toContain('Invalid Date');
    });
});
