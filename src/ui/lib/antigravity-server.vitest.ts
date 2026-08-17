import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteAntigravityConversationMock,
    getAntigravityConversationByIdMock,
    getAntigravityDecryptionStateMock,
    listAntigravityConversationsMock,
    listAntigravityWorkspaceGroupsMock,
    probeAntigravityDecryptionStateMock,
    renderAntigravityArtifactsMarkdownMock,
    renderAntigravityConversationMarkdownMock,
    renderSourceSessionsDownloadMock,
    resolveAntigravityProjectNamesMock,
    resolveAntigravityRootsMock,
    unlockAntigravityDecryptionMock,
    withAntigravityDecryptionCapabilityMock,
} = vi.hoisted(() => ({
    deleteAntigravityConversationMock: vi.fn(),
    getAntigravityConversationByIdMock: vi.fn(),
    getAntigravityDecryptionStateMock: vi.fn(),
    listAntigravityConversationsMock: vi.fn(),
    listAntigravityWorkspaceGroupsMock: vi.fn(),
    probeAntigravityDecryptionStateMock: vi.fn(),
    renderAntigravityArtifactsMarkdownMock: vi.fn(),
    renderAntigravityConversationMarkdownMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveAntigravityProjectNamesMock: vi.fn(),
    resolveAntigravityRootsMock: vi.fn(),
    unlockAntigravityDecryptionMock: vi.fn(),
    withAntigravityDecryptionCapabilityMock: vi.fn(),
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

vi.mock('@spiracha/lib/antigravity-db', () => ({
    deleteAntigravityConversation: deleteAntigravityConversationMock,
    getAntigravityConversationById: getAntigravityConversationByIdMock,
    listAntigravityConversations: listAntigravityConversationsMock,
    listAntigravityConversationsForGroup: vi.fn(),
    listAntigravityWorkspaceGroups: listAntigravityWorkspaceGroupsMock,
    renderAntigravityArtifactsMarkdown: renderAntigravityArtifactsMarkdownMock,
    renderAntigravityConversationMarkdown: renderAntigravityConversationMarkdownMock,
}));

vi.mock('@spiracha/lib/antigravity-trajectory', () => ({
    readAntigravityTrajectoryEntries: vi.fn(),
    readAntigravityTrajectoryStepIndexes: vi.fn(),
}));

vi.mock('@spiracha/lib/antigravity-keychain', () => ({
    getAntigravityDecryptionState: getAntigravityDecryptionStateMock,
    probeAntigravityDecryptionState: probeAntigravityDecryptionStateMock,
    unlockAntigravityDecryption: unlockAntigravityDecryptionMock,
    withAntigravityDecryptionCapability: withAntigravityDecryptionCapabilityMock,
}));

vi.mock('@spiracha/lib/antigravity-projects', () => ({
    resolveAntigravityProjectNames: resolveAntigravityProjectNamesMock,
}));

vi.mock('@spiracha/lib/antigravity-exporter-types', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@spiracha/lib/antigravity-exporter-types')>();
    return {
        ...actual,
        resolveAntigravityRoots: resolveAntigravityRootsMock,
    };
});

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    AntigravityDecryptionCapabilityError,
    deleteAntigravityConversationById,
    deleteAntigravityConversationsById,
    exportAntigravityConversationFn,
    exportAntigravityConversations,
    getAntigravityDecryptionStateFn,
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
    hierarchy: { parentConversationId: null },
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
    projectId: overrides.projectId ?? null,
});

describe('antigravity-server', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAntigravityDecryptionStateMock.mockReturnValue({
            canRequestAccess: true,
            error: null,
            isUnlocked: false,
            keychainAccount: 'Antigravity Key',
            keychainService: 'Antigravity Safe Storage',
            platform: 'darwin',
            provider: 'keychain',
            status: 'locked',
        });
        probeAntigravityDecryptionStateMock.mockResolvedValue(null);
        getAntigravityConversationByIdMock.mockImplementation(async (conversationId: string) =>
            (await listAntigravityConversationsMock()).find(
                (conversation: AntigravityConversation) => conversation.conversationId === conversationId,
            ),
        );
        listAntigravityWorkspaceGroupsMock.mockResolvedValue([]);
        resolveAntigravityProjectNamesMock.mockResolvedValue(new Map());
        resolveAntigravityRootsMock.mockReturnValue(['/tmp/root']);
        unlockAntigravityDecryptionMock.mockResolvedValue(null);
        withAntigravityDecryptionCapabilityMock.mockImplementation(async (action: (capability: unknown) => unknown) =>
            action({ decryptSafeStoragePayload: vi.fn() }),
        );
        renderSourceSessionsDownloadMock.mockImplementation(async ({ entries }) => ({
            fileName: `${entries[0]?.cwd}-threads-${entries.length}.zip`,
            mode: 'download_url',
        }));
    });

    it('should read cached decryption state without probing Keychain on route entry', async () => {
        const state = {
            canRequestAccess: true,
            error: null,
            isUnlocked: false,
            keychainAccount: 'Antigravity Key',
            keychainService: 'Antigravity Safe Storage',
            platform: 'darwin' as const,
            provider: 'keychain' as const,
            status: 'locked' as const,
        };
        getAntigravityDecryptionStateMock.mockReturnValue(state);

        const result = await getAntigravityDecryptionStateFn();

        expect(result).toBe(state);
        expect(getAntigravityDecryptionStateMock).toHaveBeenCalledOnce();
        expect(probeAntigravityDecryptionStateMock).not.toHaveBeenCalled();
    });

    it.each(['overview', 'trajectory'] as const)(
        'should keep readable %s transcripts available without keychain unlock',
        async (transcriptSource) => {
            const conversation = makeConversation({
                conversationPath: transcriptSource === 'trajectory' ? '/tmp/conversation.db' : '/tmp/conversation.pb',
                transcriptSource,
            });
            listAntigravityConversationsMock.mockResolvedValue([conversation]);
            renderAntigravityConversationMarkdownMock.mockResolvedValue('transcript markdown');
            renderAntigravityArtifactsMarkdownMock.mockResolvedValue(null);

            const detail = await loadAntigravityConversationDetail(conversation.conversationId);

            expect(detail.transcriptLocked).toBe(false);
            expect(detail.conversationMarkdown).toBe('transcript markdown');
        },
    );

    it('should reacquire an opaque decryption capability for every protected request', async () => {
        const conversation = makeConversation({
            transcriptPath: null,
            transcriptSource: 'safe-storage',
        });
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        renderAntigravityConversationMarkdownMock.mockResolvedValue('decrypted transcript');
        renderAntigravityArtifactsMarkdownMock.mockResolvedValue(null);

        await loadAntigravityConversationDetail(conversation.conversationId);
        await loadAntigravityConversationExport(conversation.conversationId);

        expect(withAntigravityDecryptionCapabilityMock).toHaveBeenCalledTimes(2);
        expect(renderAntigravityConversationMarkdownMock).toHaveBeenCalledWith(conversation, {
            decryptionCapability: expect.objectContaining({ decryptSafeStoragePayload: expect.any(Function) }),
        });
        expect(renderAntigravityConversationMarkdownMock).not.toHaveBeenCalledWith(
            conversation,
            expect.objectContaining({ keychainSecret: expect.anything() }),
        );
    });

    it('should acquire one decryption capability for a protected batch export', async () => {
        const conversations = [
            makeConversation({
                conversationId: 'encrypted-1',
                conversationPath: null,
                transcriptPath: null,
                transcriptSource: 'safe-storage',
            }),
            makeConversation({
                conversationId: 'encrypted-2',
                conversationPath: null,
                transcriptPath: null,
                transcriptSource: 'safe-storage',
            }),
        ];
        listAntigravityConversationsMock.mockResolvedValue(conversations);

        await exportAntigravityConversations({
            conversationIds: conversations.map((conversation) => conversation.conversationId),
            outputFormat: 'md',
            zipArchive: true,
        });

        expect(withAntigravityDecryptionCapabilityMock).toHaveBeenCalledTimes(1);
    });

    it('should map only decryption capability acquisition failures to locked detail state', async () => {
        const conversation = makeConversation({ transcriptPath: null, transcriptSource: 'safe-storage' });
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        withAntigravityDecryptionCapabilityMock.mockRejectedValue(new Error('keychain denied'));

        await expect(loadAntigravityConversationDetail(conversation.conversationId)).rejects.toThrow('keychain denied');

        withAntigravityDecryptionCapabilityMock.mockRejectedValue(
            new AntigravityDecryptionCapabilityError(new Error('keychain denied')),
        );
        const detail = await loadAntigravityConversationDetail(conversation.conversationId);
        expect(detail.transcriptLocked).toBe(true);
    });

    it('should not map an untyped capability-shaped error to locked detail state', async () => {
        const conversation = makeConversation({ transcriptPath: null, transcriptSource: 'safe-storage' });
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        const error = { code: 'ANTIGRAVITY_DECRYPTION_CAPABILITY', message: 'not a typed error' };
        withAntigravityDecryptionCapabilityMock.mockRejectedValue(error);

        await expect(loadAntigravityConversationDetail(conversation.conversationId)).rejects.toBe(error);
    });

    it('should propagate protected transcript renderer failures unchanged', async () => {
        const conversation = makeConversation({ transcriptPath: null, transcriptSource: 'safe-storage' });
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        const rendererError = new Error('malformed encrypted transcript');
        renderAntigravityConversationMarkdownMock.mockRejectedValue(rendererError);

        await expect(loadAntigravityConversationDetail(conversation.conversationId)).rejects.toBe(rendererError);
    });

    it('should return the resolved Antigravity project group for detail navigation', async () => {
        const projectId = '00ea3331-909e-4010-a208-78f964ecfb59';
        const conversation = makeConversation({ projectId });
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        listAntigravityWorkspaceGroupsMock.mockResolvedValue([
            {
                artifactCount: 0,
                conversationBytes: 0,
                conversationCount: 1,
                key: `project:${projectId}`,
                label: 'spiracha',
                lastActiveMs: 0,
                totalBytes: 0,
                transcriptCount: 1,
                uri: null,
            },
        ]);
        renderAntigravityConversationMarkdownMock.mockResolvedValue('transcript markdown');
        renderAntigravityArtifactsMarkdownMock.mockResolvedValue(null);

        const detail = await loadAntigravityConversationDetail(conversation.conversationId);

        expect(detail.conversationGroup).toEqual({
            key: `project:${projectId}`,
            label: 'spiracha',
        });
    });

    it('should name multi-conversation exports after the resolved Antigravity project', async () => {
        const projectId = '00ea3331-909e-4010-a208-78f964ecfb59';
        const conversations = [
            makeConversation({
                conversationBytes: 0,
                conversationId: 'conversation-1',
                conversationPath: null,
                projectId,
                transcriptBytes: 0,
                transcriptEntryCount: 0,
                transcriptPath: null,
                transcriptSource: null,
            }),
            makeConversation({
                conversationBytes: 0,
                conversationId: 'conversation-2',
                conversationPath: null,
                projectId,
                transcriptBytes: 0,
                transcriptEntryCount: 0,
                transcriptPath: null,
                transcriptSource: null,
            }),
        ];
        listAntigravityConversationsMock.mockResolvedValue(conversations);
        resolveAntigravityProjectNamesMock.mockResolvedValue(new Map([[projectId, 'spiracha']]));
        listAntigravityWorkspaceGroupsMock.mockResolvedValue([
            {
                artifactCount: 0,
                conversationBytes: 0,
                conversationCount: 2,
                key: `project:${projectId}`,
                label: 'spiracha',
                lastActiveMs: 0,
                totalBytes: 0,
                transcriptCount: 2,
                uri: null,
            },
        ]);
        renderAntigravityConversationMarkdownMock.mockResolvedValue('transcript markdown');

        const result = await exportAntigravityConversations({
            conversationIds: conversations.map((conversation) => conversation.conversationId),
            outputFormat: 'md',
            zipArchive: true,
        });

        expect(result.fileName).toBe('spiracha-threads-2.zip');
        expect(listAntigravityWorkspaceGroupsMock).not.toHaveBeenCalled();
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                entries: expect.arrayContaining([
                    expect.objectContaining({ cwd: 'spiracha', fileBaseName: expect.stringContaining('spiracha-') }),
                ]),
            }),
        );
    });

    it('should forward every dialog option to Antigravity transcript rendering', async () => {
        const conversation = makeConversation();
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        renderAntigravityConversationMarkdownMock.mockResolvedValue('plain transcript');

        await exportAntigravityConversations({
            conversationIds: [conversation.conversationId],
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
            zipArchive: false,
        });

        expect(renderAntigravityConversationMarkdownMock).toHaveBeenCalledWith(conversation, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                entries: [expect.objectContaining({ content: 'plain transcript' })],
                outputFormat: 'txt',
                zipArchive: false,
            }),
        );
    });

    it('should apply every dialog option and download mode to a single conversation export', async () => {
        const conversation = makeConversation();
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
        renderAntigravityConversationMarkdownMock.mockResolvedValue('plain transcript');

        const result = await exportAntigravityConversationFn({
            data: {
                conversationId: conversation.conversationId,
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'txt',
                zipArchive: true,
            },
        });

        expect(renderAntigravityConversationMarkdownMock).toHaveBeenCalledWith(conversation, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                entries: [expect.objectContaining({ content: 'plain transcript' })],
                outputFormat: 'txt',
                zipArchive: true,
            }),
        );
        expect(result).toEqual({
            fileName: '/tmp/workspace-threads-1.zip',
            mode: 'download_url',
        });
    });

    it('should suppress duplicate conversation markdown when artifacts render the same content', async () => {
        const conversation = makeConversation({ artifactCount: 1 });
        listAntigravityConversationsMock.mockResolvedValue([conversation]);
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

    it('should serialize bulk Antigravity deletes that rewrite the shared summary index', async () => {
        let releaseFirstDelete: (() => void) | undefined;
        const firstDeleteBlocked = new Promise<void>((resolve) => {
            releaseFirstDelete = resolve;
        });
        deleteAntigravityConversationMock.mockImplementation(async (_roots, conversationId: string) => {
            if (conversationId === 'conversation-1') {
                await firstDeleteBlocked;
            }
            return {
                deletedConversationIds: [conversationId],
                deletedPaths: [`/tmp/root/${conversationId}.pb`],
            };
        });

        const deletion = deleteAntigravityConversationsById(['conversation-1', 'conversation-2']);
        await vi.waitFor(() => expect(deleteAntigravityConversationMock).toHaveBeenCalled());
        try {
            expect(deleteAntigravityConversationMock).toHaveBeenCalledTimes(1);
        } finally {
            releaseFirstDelete?.();
        }
        await deletion;
        expect(deleteAntigravityConversationMock).toHaveBeenCalledTimes(2);
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
