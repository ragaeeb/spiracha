import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getAntigravityDecryptionStateMock,
    getCachedAntigravityKeychainSecretMock,
    listAntigravityConversationsMock,
    renderAntigravityArtifactsMarkdownMock,
    renderAntigravityConversationMarkdownMock,
    unlockAntigravityDecryptionMock,
} = vi.hoisted(() => ({
    getAntigravityDecryptionStateMock: vi.fn(),
    getCachedAntigravityKeychainSecretMock: vi.fn(),
    listAntigravityConversationsMock: vi.fn(),
    renderAntigravityArtifactsMarkdownMock: vi.fn(),
    renderAntigravityConversationMarkdownMock: vi.fn(),
    unlockAntigravityDecryptionMock: vi.fn(),
}));

vi.mock('@spiracha/lib/antigravity-db', () => ({
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

import { loadAntigravityConversationDetail, loadAntigravityConversationExport } from './antigravity-server';

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
});
