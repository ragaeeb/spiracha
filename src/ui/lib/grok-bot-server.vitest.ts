import { toCanonicalMessage } from '@spiracha/lib/conversation-data/adapter-helpers';
import type { ConversationDetail, ConversationMessage } from '@spiracha/lib/conversation-data/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteConversationMock,
    getConversationMock,
    listConversationsMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
} = vi.hoisted(() => ({
    deleteConversationMock: vi.fn(),
    getConversationMock: vi.fn(),
    listConversationsMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
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
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    deleteGrokBotChatFn,
    deleteGrokBotChatsFn,
    exportGrokBotChatFn,
    exportGrokBotChatsFn,
    getGrokBotChatFn,
    listGrokBotChatsFn,
} from './grok-bot-server';

const message = (overrides: Partial<ConversationMessage>): ConversationMessage =>
    toCanonicalMessage({
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
        deleteConversationMock.mockResolvedValue({ deletedFiles: [], deletedIds: ['chat-id'] });
        renderSourceSessionDownloadMock.mockResolvedValue({
            content: 'download',
            fileName: 'chat.md',
            mimeType: 'text/markdown',
            mode: 'download',
        });
        renderSourceSessionsDownloadMock.mockResolvedValue({
            downloadUrl: '/exports/chats.zip',
            fileName: 'chats.zip',
            mimeType: 'application/zip',
            mode: 'download_url',
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
        expect(exportRequest.content).toContain('Tool call');
        expect(exportRequest.content).toContain('Bamba Dev Team');
        expect(exportRequest.content).toContain('created_at: "2023-11-14T22:13:20.000Z"');
        expect(exportRequest.content).toContain('last_activity_at: "2023-11-14T22:13:20.050Z"');
        expect(exportRequest.content).toContain('roster_updated_at: "2023-11-14T22:13:20.075Z"');
        expect(exportRequest.content).toContain('replica_persisted_at: "2023-11-14T22:13:20.100Z"');
        expect(exportRequest.content).toContain('Working on the app');
        expect(exportRequest.content).toContain('notes.md');
        expect(exportRequest.content).toContain('## Kiwi');

        await expect(deleteGrokBotChatFn({ data: { conversationId: 'chat-id' } } as never)).resolves.toEqual({
            deletedFiles: [],
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
        expect(exportRequest.content).toContain('Thinking note');
        expect(exportRequest.content).not.toContain('Tool call');
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
        expect(content).toContain('Assistant · Final answer');
        expect(content).not.toContain('Invalid Date');
    });

    it('should export and delete selected Grok Bot chats in a batch', async () => {
        const first = chat();
        const second = chat();
        second.id = 'chat-id-2';
        second.title = 'Kiwi';
        getConversationMock.mockImplementation(async (options: { id: string }) =>
            options.id === 'chat-id-2' ? second : first,
        );
        await expect(
            exportGrokBotChatsFn({
                data: {
                    conversationIds: ['chat-id', 'chat-id-2'],
                    includeCommentary: false,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    zipArchive: true,
                },
            } as never),
        ).resolves.toEqual({
            downloadUrl: '/exports/chats.zip',
            fileName: 'chats.zip',
            mimeType: 'application/zip',
            mode: 'download_url',
        });
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith({
            entries: [
                {
                    content: expect.stringContaining('Bamba Dev Team'),
                    cwd: null,
                    fallbackBaseName: 'grok-bot-chat',
                    fileBaseName: 'Bamba Dev Team',
                    sessionId: 'chat-id',
                    updatedAtMs: 1_700_000_000_100,
                },
                {
                    content: expect.stringContaining('Kiwi'),
                    cwd: null,
                    fallbackBaseName: 'grok-bot-chat',
                    fileBaseName: 'Kiwi',
                    sessionId: 'chat-id-2',
                    updatedAtMs: 1_700_000_000_100,
                },
            ],
            fallbackBaseName: 'grok-bot-chats',
            outputFormat: 'md',
            platform: 'grok-bot',
            zipArchive: true,
        });

        deleteConversationMock
            .mockResolvedValueOnce({ deletedFiles: [], deletedIds: ['chat-id'] })
            .mockResolvedValueOnce({ deletedFiles: [], deletedIds: ['chat-id-2'] });
        await expect(
            deleteGrokBotChatsFn({ data: { conversationIds: ['chat-id', 'chat-id-2'] } } as never),
        ).resolves.toMatchObject({
            deletedFiles: [],
            deletedIds: ['chat-id', 'chat-id-2'],
            missingIds: [],
            summary: { cleanupPending: 0, deleted: 2, failed: 0, missing: 0 },
        });
        expect(deleteConversationMock).toHaveBeenNthCalledWith(1, { id: 'chat-id', source: 'grok-bot' });
        expect(deleteConversationMock).toHaveBeenNthCalledWith(2, { id: 'chat-id-2', source: 'grok-bot' });

        deleteConversationMock
            .mockResolvedValueOnce({ deletedFiles: [], deletedIds: [] })
            .mockRejectedValueOnce(new Error('Gateway unavailable'));
        const retry = await deleteGrokBotChatsFn({
            data: { conversationIds: ['chat-id', 'chat-id-2'] },
        } as never);
        expect(retry.outcomes.map((outcome) => [outcome.id, outcome.status])).toEqual([
            ['chat-id', 'missing'],
            ['chat-id-2', 'failed'],
        ]);
    });
});
