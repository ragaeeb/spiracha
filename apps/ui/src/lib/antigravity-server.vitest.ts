import type { AntigravityConversation } from '@spiracha/lib/antigravity-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteAntigravityConversationMock,
    getAntigravityDecryptionStateMock,
    getAntigravityConversationByIdMock,
    getCachedAntigravityKeychainSecretMock,
    listAntigravityConversationsMock,
    listAntigravityWorkspaceGroupsMock,
    renderAntigravityArtifactsMarkdownMock,
    renderAntigravityConversationMarkdownMock,
    renderSourceSessionsDownloadMock,
    resolveAntigravityProjectNamesMock,
    resolveAntigravityRootsMock,
    unlockAntigravityDecryptionMock,
} = vi.hoisted(() => ({
    deleteAntigravityConversationMock: vi.fn(),
    getAntigravityConversationByIdMock: vi.fn(),
    getAntigravityDecryptionStateMock: vi.fn(),
    getCachedAntigravityKeychainSecretMock: vi.fn(),
    listAntigravityConversationsMock: vi.fn(),
    listAntigravityWorkspaceGroupsMock: vi.fn(),
    renderAntigravityArtifactsMarkdownMock: vi.fn(),
    renderAntigravityConversationMarkdownMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveAntigravityProjectNamesMock: vi.fn(),
    resolveAntigravityRootsMock: vi.fn(),
    unlockAntigravityDecryptionMock: vi.fn(),
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
    getCachedAntigravityKeychainSecret: getCachedAntigravityKeychainSecretMock,
    unlockAntigravityDecryption: unlockAntigravityDecryptionMock,
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
    deleteAntigravityConversationById,
    deleteAntigravityConversationsById,
    exportAntigravityConversationFn,
    exportAntigravityConversations,
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
    projectId: overrides.projectId ?? null,
});

describe('antigravity-server', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAntigravityDecryptionStateMock.mockResolvedValue(null);
        getAntigravityConversationByIdMock.mockImplementation(async (conversationId: string) =>
            (await listAntigravityConversationsMock()).find(
                (conversation: AntigravityConversation) => conversation.conversationId === conversationId,
            ),
        );
        listAntigravityWorkspaceGroupsMock.mockResolvedValue([]);
        resolveAntigravityProjectNamesMock.mockResolvedValue(new Map());
        resolveAntigravityRootsMock.mockReturnValue(['/tmp/root']);
        unlockAntigravityDecryptionMock.mockResolvedValue(null);
        renderSourceSessionsDownloadMock.mockImplementation(async ({ entries }) => ({
            fileName: `${entries[0]?.cwd}-threads-${entries.length}.zip`,
            mode: 'download_url',
        }));
    });

    it.each(['overview', 'trajectory'] as const)(
        'should keep readable %s transcripts available without keychain unlock',
        async (transcriptSource) => {
            const conversation = makeConversation({
                conversationPath: transcriptSource === 'trajectory' ? '/tmp/conversation.db' : '/tmp/conversation.pb',
                transcriptSource,
            });
            listAntigravityConversationsMock.mockResolvedValue([conversation]);
            getCachedAntigravityKeychainSecretMock.mockReturnValue(null);
            renderAntigravityConversationMarkdownMock.mockResolvedValue('transcript markdown');
            renderAntigravityArtifactsMarkdownMock.mockResolvedValue(null);

            const detail = await loadAntigravityConversationDetail(conversation.conversationId);

            expect(detail.transcriptLocked).toBe(false);
            expect(detail.conversationMarkdown).toBe('transcript markdown');
        },
    );

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
        getCachedAntigravityKeychainSecretMock.mockReturnValue(null);
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
        getCachedAntigravityKeychainSecretMock.mockReturnValue(null);
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
        getCachedAntigravityKeychainSecretMock.mockReturnValue(null);
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
            keychainSecret: null,
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
        getCachedAntigravityKeychainSecretMock.mockReturnValue(null);
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
            keychainSecret: null,
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
