import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteAntigravityConversationMock,
    getAntigravityDecryptionStateMock,
    getCachedAntigravityKeychainSecretMock,
    listAntigravityConversationsMock,
    renderAntigravityArtifactsMarkdownMock,
    renderAntigravityConversationMarkdownMock,
    resolveAntigravityRootsMock,
    unlockAntigravityDecryptionMock,
} = vi.hoisted(() => ({
    deleteAntigravityConversationMock: vi.fn(),
    getAntigravityDecryptionStateMock: vi.fn(),
    getCachedAntigravityKeychainSecretMock: vi.fn(),
    listAntigravityConversationsMock: vi.fn(),
    renderAntigravityArtifactsMarkdownMock: vi.fn(),
    renderAntigravityConversationMarkdownMock: vi.fn(),
    resolveAntigravityRootsMock: vi.fn(),
    unlockAntigravityDecryptionMock: vi.fn(),
}));

vi.mock('@spiracha/lib/antigravity-db', () => ({
    deleteAntigravityConversation: deleteAntigravityConversationMock,
    listAntigravityConversations: listAntigravityConversationsMock,
    listAntigravityConversationsForGroup: vi.fn(),
    listAntigravityWorkspaceGroups: vi.fn(),
    renderAntigravityArtifactsMarkdown: renderAntigravityArtifactsMarkdownMock,
    renderAntigravityConversationMarkdown: renderAntigravityConversationMarkdownMock,
}));

vi.mock('@spiracha/lib/antigravity-keychain', () => ({
    getAntigravityDecryptionState: getAntigravityDecryptionStateMock,
    getCachedAntigravityKeychainSecret: getCachedAntigravityKeychainSecretMock,
    unlockAntigravityDecryption: unlockAntigravityDecryptionMock,
}));

vi.mock('@spiracha/lib/antigravity-exporter-types', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@spiracha/lib/antigravity-exporter-types')>();
    return {
        ...actual,
        resolveAntigravityRoots: resolveAntigravityRootsMock,
    };
});

import {
    deleteAntigravityConversationById,
    deleteAntigravityConversationsById,
    loadAntigravityConversationDetail,
    loadAntigravityConversationExport,
} from './antigravity-server';

const makeConversation = (overrides: Partial<AntigravityConversation> = {}): AntigravityConversation => ({
    artifactBytes: 0,
    artifactCount: 0,
    artifacts: [],
    conversationBytes: 512,
    conversationId: 'conversation-1',
    conversationMtimeMs: 1_700_000_000_000,
    conversationPath: '/tmp/conversation.pb',
    createdAtMs: 1_700_000_000_000,
    indexedItemCount: 3,
    lastUpdatedAtMs: 1_700_000_100_000,
    model: null,
    sourceRoot: '/tmp/root',
    summaryPath: '/tmp/summary.pb',
    title: 'Conversation one',
    totalBytes: 640,
    transcriptBytes: 128,
    transcriptEntryCount: 2,
    transcriptPath: '/tmp/overview.txt',
    transcriptSource: 'overview',
    workspaceFolder: '/tmp/workspace',
    workspaceKey: 'folder:/tmp/workspace',
    workspaceLabel: 'workspace',
    workspaceUri: 'file:///tmp/workspace',
    ...overrides,
});

describe('antigravity-server', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAntigravityDecryptionStateMock.mockResolvedValue(null);
        resolveAntigravityRootsMock.mockReturnValue(['/tmp/root']);
        unlockAntigravityDecryptionMock.mockResolvedValue(null);
    });

    it('should keep readable local-log transcripts available without keychain unlock', async () => {
        const conversation = makeConversation();
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        getCachedAntigravityKeychainSecretMock.mockReturnValue(null);
        renderAntigravityConversationMarkdownMock.mockResolvedValue('transcript markdown');
        renderAntigravityArtifactsMarkdownMock.mockResolvedValue(null);

        const detail = await loadAntigravityConversationDetail(conversation.conversationId);

        expect(detail.transcriptLocked).toBe(false);
        expect(detail.conversationMarkdown).toBe('transcript markdown');
    });

    it('should suppress duplicate conversation markdown when artifacts render the same content', async () => {
        const conversation = makeConversation({ artifactCount: 1 });
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        getCachedAntigravityKeychainSecretMock.mockReturnValue(null);
        renderAntigravityConversationMarkdownMock.mockResolvedValue('# Duplicate\n\nsame body');
        renderAntigravityArtifactsMarkdownMock.mockResolvedValue('# Duplicate\n\nsame body');

        const detail = await loadAntigravityConversationDetail(conversation.conversationId);

        expect(detail.artifactsMarkdown).toBe('# Duplicate\n\nsame body');
        expect(detail.conversationMarkdown).toBeNull();
    });

    it('should reject conversation export when only artifacts are available', async () => {
        const conversation = makeConversation({
            artifactCount: 2,
            conversationPath: null,
            transcriptBytes: 0,
            transcriptEntryCount: 0,
            transcriptPath: null,
            transcriptSource: null,
        });
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        getCachedAntigravityKeychainSecretMock.mockReturnValue(null);
        renderAntigravityConversationMarkdownMock.mockResolvedValue('# Artifacts\n\nartifact body');

        await expect(loadAntigravityConversationExport(conversation.conversationId)).rejects.toThrow(
            'No exportable Antigravity transcript found',
        );
    });

    it('should reject a single Antigravity delete when nothing was removed', async () => {
        deleteAntigravityConversationMock.mockResolvedValue({
            deletedConversationIds: [],
            deletedPaths: [],
        });

        await expect(deleteAntigravityConversationById('missing-conversation')).rejects.toThrow(
            'Antigravity conversation not found: missing-conversation',
        );
    });

    it('should aggregate bulk Antigravity delete results', async () => {
        deleteAntigravityConversationMock
            .mockResolvedValueOnce({
                deletedConversationIds: ['conversation-1'],
                deletedPaths: ['/tmp/root/conversation-1.pb'],
            })
            .mockResolvedValueOnce({
                deletedConversationIds: ['conversation-2'],
                deletedPaths: ['/tmp/root/conversation-2.pb', '/tmp/root/brain/conversation-2'],
            });

        const result = await deleteAntigravityConversationsById(['conversation-1', 'conversation-2']);

        expect(result).toEqual({
            deletedConversationIds: ['conversation-1', 'conversation-2'],
            deletedPaths: [
                '/tmp/root/conversation-1.pb',
                '/tmp/root/conversation-2.pb',
                '/tmp/root/brain/conversation-2',
            ],
        });
    });

    it('should reject bulk Antigravity delete when nothing was removed', async () => {
        deleteAntigravityConversationMock.mockResolvedValue({
            deletedConversationIds: [],
            deletedPaths: [],
        });

        await expect(deleteAntigravityConversationsById(['missing-1', 'missing-2'])).rejects.toThrow(
            'No Antigravity conversations were deleted',
        );
    });
});
