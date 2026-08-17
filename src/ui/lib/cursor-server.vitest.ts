import type {
    CursorThreadSummary,
    CursorThreadTranscript,
    CursorWorkspaceBucket,
    CursorWorkspaceGroup,
} from '@spiracha/lib/cursor-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    collectCursorThreadsForDeletionMock,
    deleteCursorWorkspaceBucketsMock,
    deleteCursorWorkspaceHistoryMock,
    findCursorTranscriptDirsForComposerIdsMock,
    isCursorRunningMock,
    listCursorThreadsForGroupMock,
    listCursorWorkspaceGroupsMock,
    pruneCursorThreadsMock,
    retryCursorWorkspaceCleanupMock,
    readCursorThreadTranscriptWithAgentFilesMock,
    recoverCursorWorkspaceGroupMock,
    renderCursorTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
} = vi.hoisted(() => ({
    collectCursorThreadsForDeletionMock: vi.fn(),
    deleteCursorWorkspaceBucketsMock: vi.fn(),
    deleteCursorWorkspaceHistoryMock: vi.fn(),
    findCursorTranscriptDirsForComposerIdsMock: vi.fn(),
    isCursorRunningMock: vi.fn(),
    listCursorThreadsForGroupMock: vi.fn(),
    listCursorWorkspaceGroupsMock: vi.fn(),
    pruneCursorThreadsMock: vi.fn(),
    readCursorThreadTranscriptWithAgentFilesMock: vi.fn(),
    recoverCursorWorkspaceGroupMock: vi.fn(),
    renderCursorTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    retryCursorWorkspaceCleanupMock: vi.fn(),
}));

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        let inputValidator: { parse: (value: unknown) => unknown } | undefined;
        const serverFn = {
            handler: (callback: unknown) => {
                const handler = callback as (args?: { data?: unknown }) => unknown;
                return async (args?: { data?: unknown }) => {
                    if (!inputValidator) {
                        return await handler(args);
                    }

                    return await handler({ ...args, data: inputValidator.parse(args?.data) });
                };
            },
            validator: (validator: unknown) => {
                inputValidator = validator as { parse: (value: unknown) => unknown };
                return serverFn;
            },
        };

        return serverFn;
    },
}));

vi.mock('@spiracha/lib/cursor-db', () => ({
    findCursorTranscriptDirsForComposerIds: findCursorTranscriptDirsForComposerIdsMock,
    listCursorThreadsForGroup: listCursorThreadsForGroupMock,
    listCursorWorkspaceGroups: listCursorWorkspaceGroupsMock,
    readCursorThreadTranscript: vi.fn(),
    readCursorThreadTranscriptWithAgentFiles: readCursorThreadTranscriptWithAgentFilesMock,
}));

vi.mock('@spiracha/lib/cursor-exporter-types', () => ({
    getCursorGlobalDbPath: vi.fn(() => '/tmp/global.db'),
}));

vi.mock('@spiracha/lib/cursor-recovery', () => ({
    collectCursorThreadsForDeletion: collectCursorThreadsForDeletionMock,
    deleteCursorWorkspaceBuckets: deleteCursorWorkspaceBucketsMock,
    deleteCursorWorkspaceHistory: deleteCursorWorkspaceHistoryMock,
    isCursorRunning: isCursorRunningMock,
    pruneCursorThreads: pruneCursorThreadsMock,
    recoverCursorWorkspaceGroup: recoverCursorWorkspaceGroupMock,
    retryCursorWorkspaceCleanup: retryCursorWorkspaceCleanupMock,
}));

vi.mock('@spiracha/lib/cursor-transcript', () => ({
    renderCursorTranscript: renderCursorTranscriptMock,
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    deleteCursorThreadsFn,
    deleteCursorWorkspaceFn,
    deleteCursorWorkspacesFn,
    exportCursorThreadFn,
    exportCursorThreadsFn,
    findCursorThreadByComposerId,
} from './cursor-server';

const workspaceOne: CursorWorkspaceGroup = {
    buckets: [],
    folders: ['/tmp/one'],
    key: 'folder:/tmp/one',
    kind: 'folder',
    label: 'one',
    lastActiveMs: 1_700_000_100_000,
    needsRecovery: false,
    threadCount: 1,
    uri: 'file:///tmp/one',
};

const workspaceTwo: CursorWorkspaceGroup = {
    buckets: [],
    folders: ['/tmp/two'],
    key: 'folder:/tmp/two',
    kind: 'folder',
    label: 'two',
    lastActiveMs: 1_700_000_200_000,
    needsRecovery: false,
    threadCount: 1,
    uri: 'file:///tmp/two',
};

const workspaceBucket: CursorWorkspaceBucket = {
    bucketId: 'bucket-1',
    composerCount: 0,
    dbPath: '/tmp/cursor/workspaceStorage/bucket-1/state.vscdb',
    dbSizeBytes: 1024,
    folders: workspaceOne.folders,
    globalHeaderCount: 3,
    kind: 'folder',
    label: workspaceOne.label,
    mtimeMs: workspaceOne.lastActiveMs,
    threadComposerIds: ['thread-1', 'thread-2', 'aborted-thread'],
    uri: workspaceOne.uri,
    workspaceJsonPath: '/tmp/cursor/workspaceStorage/bucket-1/workspace.json',
};

const makeThread = (overrides: Partial<CursorThreadSummary> = {}): CursorThreadSummary => ({
    bubbleBytes: 128,
    bubbleCount: 3,
    bucketId: 'bucket-1',
    composerId: 'thread-1',
    createdAtMs: 1_700_000_000_000,
    lastUpdatedAtMs: 1_700_000_100_000,
    mode: 'agent',
    model: null,
    name: 'Thread one',
    parentComposerId: null,
    reasoningEffort: null,
    transcriptDirs: [],
    workspaceKey: workspaceOne.key,
    workspaceLabel: workspaceOne.label,
    ...overrides,
});

const transcript: CursorThreadTranscript = {
    bubbles: [],
    head: {
        composerId: 'thread-1',
        createdAtMs: 1_700_000_000_000,
        lastUpdatedAtMs: 1_700_000_100_000,
        mode: 'agent',
        name: 'Thread one',
        orderedBubbleIds: [],
        totalBubbleHeaders: 0,
    },
    omittedBubbleCount: 0,
    renderableBubbleCount: 0,
};

describe('findCursorThreadByComposerId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isCursorRunningMock.mockResolvedValue(false);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });
        deleteCursorWorkspaceHistoryMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });
    });

    it('should query workspace threads without transcript directory discovery', async () => {
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne, workspaceTwo]);
        listCursorThreadsForGroupMock.mockResolvedValueOnce([makeThread()]).mockResolvedValueOnce([
            makeThread({
                composerId: 'thread-2',
                workspaceKey: workspaceTwo.key,
                workspaceLabel: workspaceTwo.label,
            }),
        ]);

        const thread = await findCursorThreadByComposerId('thread-2');

        expect(thread?.composerId).toBe('thread-2');
        expect(listCursorThreadsForGroupMock).toHaveBeenNthCalledWith(1, workspaceOne, undefined, {
            includeTranscriptDirs: false,
        });
        expect(listCursorThreadsForGroupMock).toHaveBeenNthCalledWith(2, workspaceTwo, undefined, {
            includeTranscriptDirs: false,
        });
    });
});

describe('deleteCursorThreadsFn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isCursorRunningMock.mockResolvedValue(false);
    });

    it('should delete selected Cursor threads through the recovery pruning path', async () => {
        const deletableThreads = [makeThread(), makeThread({ composerId: 'thread-2' })];
        const result = {
            bubblesDeleted: 4,
            composerDataDeleted: 2,
            composerIds: ['thread-1', 'thread-2'],
            headersRemoved: 2,
            transcriptDirsRemoved: 1,
            workspaceBucketsUpdated: 1,
        };
        collectCursorThreadsForDeletionMock.mockResolvedValue(deletableThreads);
        pruneCursorThreadsMock.mockResolvedValue(result);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });

        await expect(deleteCursorThreadsFn({ data: { composerIds: ['thread-1', 'thread-2'] } })).resolves.toBe(result);

        expect(isCursorRunningMock).toHaveBeenCalledTimes(1);
        expect(collectCursorThreadsForDeletionMock).toHaveBeenCalledWith(['thread-1', 'thread-2']);
        expect(pruneCursorThreadsMock).toHaveBeenCalledWith(deletableThreads, true);
    });

    it('should refuse to delete Cursor threads while Cursor is running', async () => {
        isCursorRunningMock.mockResolvedValue(true);

        await expect(deleteCursorThreadsFn({ data: { composerIds: ['thread-1'] } })).rejects.toThrow(
            'Quit Cursor before deleting.',
        );

        expect(collectCursorThreadsForDeletionMock).not.toHaveBeenCalled();
        expect(pruneCursorThreadsMock).not.toHaveBeenCalled();
    });

    it('should reject traversal and wildcard composer ids before delete work starts', async () => {
        for (const composerId of ['../../..', '%', 'thread%']) {
            await expect(deleteCursorThreadsFn({ data: { composerIds: [composerId] } })).rejects.toThrow();
        }

        expect(isCursorRunningMock).not.toHaveBeenCalled();
        expect(collectCursorThreadsForDeletionMock).not.toHaveBeenCalled();
        expect(pruneCursorThreadsMock).not.toHaveBeenCalled();
    });
});

describe('deleteCursorWorkspaceFn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isCursorRunningMock.mockResolvedValue(false);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });
        deleteCursorWorkspaceHistoryMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });
    });

    it('should delete every Cursor thread in a workspace', async () => {
        const workspace = { ...workspaceOne, buckets: [workspaceBucket], threadCount: 3 };
        const workspaceThreads = [makeThread(), makeThread({ composerId: 'thread-2' })];
        const deletableThreads = [...workspaceThreads, makeThread({ composerId: 'aborted-thread' })].map((thread) => ({
            composerId: thread.composerId,
        }));
        const result = {
            bubblesDeleted: 5,
            composerDataDeleted: 3,
            composerIds: ['thread-1', 'thread-2', 'aborted-thread'],
            headersRemoved: 3,
            transcriptDirsRemoved: 2,
            workspaceBucketsUpdated: 1,
        };
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspace]);
        listCursorThreadsForGroupMock.mockResolvedValue(workspaceThreads);
        collectCursorThreadsForDeletionMock.mockResolvedValue(deletableThreads);
        pruneCursorThreadsMock.mockResolvedValue(result);

        await expect(deleteCursorWorkspaceFn({ data: { workspaceKey: workspace.key } })).resolves.toBe(result);

        expect(listCursorThreadsForGroupMock).toHaveBeenCalledWith(workspace, undefined, {
            includeTranscriptDirs: false,
        });
        expect(collectCursorThreadsForDeletionMock).toHaveBeenCalledWith(['thread-1', 'thread-2', 'aborted-thread']);
        expect(pruneCursorThreadsMock).toHaveBeenCalledWith(deletableThreads, true);
        expect(deleteCursorWorkspaceBucketsMock).toHaveBeenCalledWith(workspace);
        expect(deleteCursorWorkspaceHistoryMock).toHaveBeenCalledWith(workspace);
    });

    it('should remove an already-empty Cursor workspace bucket', async () => {
        const result = {
            bubblesDeleted: 0,
            cleanupFailures: [],
            composerDataDeleted: 0,
            composerIds: [],
            headersRemoved: 0,
            transcriptDirsRemoved: 0,
            transcriptDirsRemovedPaths: [],
            workspaceBucketsUpdated: 0,
        };
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne]);
        listCursorThreadsForGroupMock.mockResolvedValue([]);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });

        await expect(deleteCursorWorkspaceFn({ data: { workspaceKey: workspaceOne.key } })).resolves.toEqual({
            ...result,
            workspaceBucketsRemovedPaths: [],
            workspaceHistoryRemovedPaths: [],
        });

        expect(collectCursorThreadsForDeletionMock).not.toHaveBeenCalled();
        expect(pruneCursorThreadsMock).not.toHaveBeenCalled();
        expect(deleteCursorWorkspaceBucketsMock).toHaveBeenCalledWith(workspaceOne);
        expect(deleteCursorWorkspaceHistoryMock).toHaveBeenCalledWith(workspaceOne);
    });

    it('should return filesystem cleanup failures after the database deletion succeeds', async () => {
        const result = {
            bubblesDeleted: 1,
            cleanupFailures: [],
            composerDataDeleted: 1,
            composerIds: ['thread-1'],
            headersRemoved: 1,
            transcriptDirsRemoved: 1,
            workspaceBucketsUpdated: 1,
        };
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne]);
        listCursorThreadsForGroupMock.mockResolvedValue([makeThread()]);
        collectCursorThreadsForDeletionMock.mockResolvedValue([{ composerId: 'thread-1' }]);
        pruneCursorThreadsMock.mockResolvedValue(result);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({
            cleanupFailures: [{ error: 'workspace bucket is busy', path: '/tmp/bucket-b', phase: 'workspace_buckets' }],
            removedPaths: ['/tmp/bucket-a'],
        });
        deleteCursorWorkspaceHistoryMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });

        await expect(deleteCursorWorkspaceFn({ data: { workspaceKey: workspaceOne.key } })).resolves.toMatchObject({
            ...result,
            cleanupFailures: [{ error: 'workspace bucket is busy', path: '/tmp/bucket-b', phase: 'workspace_buckets' }],
            retryTarget: { token: expect.any(String) },
            workspaceBucketsRemovedPaths: ['/tmp/bucket-a'],
        });
        expect(deleteCursorWorkspaceHistoryMock).toHaveBeenCalledWith(workspaceOne);
    });

    it('should retry cleanup from the returned target after the workspace is no longer discoverable', async () => {
        const retryPlan = {
            bucketPaths: [],
            composerIds: ['thread-1'],
            folders: workspaceOne.folders,
            historyPaths: [],
            transcriptDirs: ['/tmp/transcript/thread-1'],
            workspaceKey: workspaceOne.key,
        };
        const firstResult = {
            bubblesDeleted: 1,
            cleanupFailures: [
                {
                    error: 'transcript is busy',
                    path: '/tmp/transcript/thread-1',
                    phase: 'transcript_directory' as const,
                },
            ],
            composerDataDeleted: 1,
            composerIds: ['thread-1'],
            headersRemoved: 1,
            transcriptDirsRemoved: 0,
            transcriptDirsRemovedPaths: [],
            workspaceBucketsUpdated: 1,
        };
        const retryResult = { ...firstResult, cleanupFailures: [] };
        listCursorWorkspaceGroupsMock.mockResolvedValueOnce([workspaceOne]);
        listCursorThreadsForGroupMock.mockResolvedValueOnce([makeThread()]);
        collectCursorThreadsForDeletionMock.mockResolvedValueOnce([{ composerId: 'thread-1' }]);
        pruneCursorThreadsMock.mockResolvedValueOnce(firstResult);
        retryCursorWorkspaceCleanupMock.mockResolvedValue(retryResult);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });
        deleteCursorWorkspaceHistoryMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });

        const firstResponse = await deleteCursorWorkspaceFn({ data: { workspaceKey: workspaceOne.key } });
        expect(firstResponse).toMatchObject({ retryTarget: { token: expect.any(String) } });
        expect(firstResponse).not.toHaveProperty('retryPlan');
        if (!firstResponse.retryTarget) {
            throw new Error('Expected a server-held Cursor cleanup retry token.');
        }
        await expect(
            deleteCursorWorkspaceFn({
                data: { retry: firstResponse.retryTarget, workspaceKey: 'folder:/tmp/other-workspace' },
            }),
        ).rejects.toThrow('does not match the workspace key');
        expect(retryCursorWorkspaceCleanupMock).not.toHaveBeenCalled();
        await expect(
            deleteCursorWorkspaceFn({ data: { retry: firstResponse.retryTarget, workspaceKey: workspaceOne.key } }),
        ).resolves.toEqual(retryResult);

        expect(retryCursorWorkspaceCleanupMock).toHaveBeenCalledWith(retryPlan);
        expect(listCursorWorkspaceGroupsMock).toHaveBeenCalledTimes(1);
    });

    it('should consume a retry token before awaiting cleanup so concurrent replays are rejected', async () => {
        const result = {
            bubblesDeleted: 0,
            cleanupFailures: [],
            composerDataDeleted: 0,
            composerIds: ['thread-1'],
            headersRemoved: 0,
            transcriptDirsRemoved: 0,
            workspaceBucketsUpdated: 0,
        };
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne]);
        listCursorThreadsForGroupMock.mockResolvedValue([makeThread()]);
        collectCursorThreadsForDeletionMock.mockResolvedValue([{ composerId: 'thread-1' }]);
        pruneCursorThreadsMock.mockResolvedValue(result);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({
            cleanupFailures: [{ error: 'busy', path: '/tmp/bucket', phase: 'workspace_buckets' }],
            removedPaths: [],
        });
        deleteCursorWorkspaceHistoryMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });

        const firstResponse = await deleteCursorWorkspaceFn({ data: { workspaceKey: workspaceOne.key } });
        if (!firstResponse.retryTarget) {
            throw new Error('Expected a server-held Cursor cleanup retry token.');
        }

        let releaseRetry!: (value: typeof result) => void;
        retryCursorWorkspaceCleanupMock.mockImplementation(
            () => new Promise((resolve) => (releaseRetry = resolve as (value: typeof result) => void)),
        );
        const retryInput = { data: { retry: firstResponse.retryTarget, workspaceKey: workspaceOne.key } };
        const firstRetry = deleteCursorWorkspaceFn(retryInput);
        await vi.waitFor(() => expect(retryCursorWorkspaceCleanupMock).toHaveBeenCalledTimes(1));

        await expect(deleteCursorWorkspaceFn(retryInput)).rejects.toThrow('missing or expired');
        releaseRetry({ ...result, cleanupFailures: [] });
        await expect(firstRetry).resolves.toMatchObject({ cleanupFailures: [] });
    });

    it('should validate duplicate batch retry tokens before consuming any token', async () => {
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne]);
        listCursorThreadsForGroupMock.mockResolvedValue([]);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({
            cleanupFailures: [{ error: 'busy', path: '/tmp/bucket', phase: 'workspace_buckets' }],
            removedPaths: [],
        });
        deleteCursorWorkspaceHistoryMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });

        const firstResponse = await deleteCursorWorkspaceFn({ data: { workspaceKey: workspaceOne.key } });
        if (!firstResponse.retryTarget) {
            throw new Error('Expected a server-held Cursor cleanup retry token.');
        }

        retryCursorWorkspaceCleanupMock.mockResolvedValue({
            bubblesDeleted: 0,
            cleanupFailures: [],
            composerDataDeleted: 0,
            composerIds: [],
            headersRemoved: 0,
            transcriptDirsRemoved: 0,
            transcriptDirsRemovedPaths: [],
            workspaceBucketsUpdated: 0,
        });
        await expect(
            deleteCursorWorkspacesFn({
                data: {
                    retryTargets: [firstResponse.retryTarget, firstResponse.retryTarget],
                    workspaceKeys: [workspaceOne.key, workspaceOne.key],
                },
            }),
        ).rejects.toThrow('must not reuse a token');
        expect(retryCursorWorkspaceCleanupMock).not.toHaveBeenCalled();

        await expect(
            deleteCursorWorkspaceFn({ data: { retry: firstResponse.retryTarget, workspaceKey: workspaceOne.key } }),
        ).resolves.toMatchObject({ cleanupFailures: [] });
    });
});

describe('deleteCursorWorkspacesFn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isCursorRunningMock.mockResolvedValue(false);
        listCursorWorkspaceGroupsMock.mockReset();
        deleteCursorWorkspaceBucketsMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });
        deleteCursorWorkspaceHistoryMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });
    });

    it('should reject workspace deletion batches larger than the retry token capacity', async () => {
        const workspaceKeys = Array.from({ length: 129 }, (_value, index) => `folder:/tmp/workspace-${index}`);

        await expect(deleteCursorWorkspacesFn({ data: { workspaceKeys } })).rejects.toThrow();
        expect(isCursorRunningMock).not.toHaveBeenCalled();
    });

    it('should delete multiple Cursor workspaces in one request', async () => {
        const workspaceOneResult = {
            bubblesDeleted: 1,
            composerDataDeleted: 1,
            composerIds: ['thread-1'],
            headersRemoved: 1,
            transcriptDirsRemoved: 1,
            workspaceBucketsUpdated: 1,
        };
        const workspaceTwoResult = {
            bubblesDeleted: 2,
            composerDataDeleted: 1,
            composerIds: ['thread-2'],
            headersRemoved: 1,
            transcriptDirsRemoved: 1,
            workspaceBucketsUpdated: 1,
        };
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne, workspaceTwo]);
        listCursorThreadsForGroupMock
            .mockResolvedValueOnce([makeThread()])
            .mockResolvedValueOnce([makeThread({ composerId: 'thread-2', workspaceKey: workspaceTwo.key })]);
        collectCursorThreadsForDeletionMock
            .mockResolvedValueOnce([{ composerId: 'thread-1' }])
            .mockResolvedValueOnce([{ composerId: 'thread-2' }]);
        pruneCursorThreadsMock.mockResolvedValueOnce(workspaceOneResult).mockResolvedValueOnce(workspaceTwoResult);

        await expect(
            deleteCursorWorkspacesFn({ data: { workspaceKeys: [workspaceOne.key, workspaceTwo.key] } }),
        ).resolves.toMatchObject([workspaceOneResult, workspaceTwoResult]);

        expect(isCursorRunningMock).toHaveBeenCalledTimes(1);
        expect(listCursorWorkspaceGroupsMock).toHaveBeenCalledTimes(1);
        expect(deleteCursorWorkspaceBucketsMock).toHaveBeenNthCalledWith(1, workspaceOne);
        expect(deleteCursorWorkspaceBucketsMock).toHaveBeenNthCalledWith(2, workspaceTwo);
        expect(deleteCursorWorkspaceHistoryMock).toHaveBeenNthCalledWith(1, workspaceOne);
        expect(deleteCursorWorkspaceHistoryMock).toHaveBeenNthCalledWith(2, workspaceTwo);
    });

    it('should propagate a later workspace deletion failure after preserving the first result', async () => {
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne, workspaceTwo]);
        listCursorThreadsForGroupMock
            .mockResolvedValueOnce([makeThread()])
            .mockResolvedValueOnce([makeThread({ composerId: 'thread-2', workspaceKey: workspaceTwo.key })]);
        collectCursorThreadsForDeletionMock
            .mockResolvedValueOnce([{ composerId: 'thread-1' }])
            .mockResolvedValueOnce([{ composerId: 'thread-2' }]);
        pruneCursorThreadsMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('second prune failed'));

        await expect(
            deleteCursorWorkspacesFn({ data: { workspaceKeys: [workspaceOne.key, workspaceTwo.key] } }),
        ).rejects.toThrow('second prune failed');

        expect(pruneCursorThreadsMock).toHaveBeenNthCalledWith(1, [{ composerId: 'thread-1' }], true);
        expect(deleteCursorWorkspaceBucketsMock).toHaveBeenNthCalledWith(1, workspaceOne);
        expect(deleteCursorWorkspaceHistoryMock).toHaveBeenNthCalledWith(1, workspaceOne);
    });
});

describe('Cursor export server functions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne]);
        listCursorThreadsForGroupMock.mockResolvedValue([makeThread()]);
        findCursorTranscriptDirsForComposerIdsMock.mockResolvedValue(new Map([['thread-1', ['/tmp/transcript']]]));
        readCursorThreadTranscriptWithAgentFilesMock.mockResolvedValue(transcript);
        renderCursorTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionDownloadMock.mockResolvedValue({
            content: 'rendered transcript',
            fileName: 'cursor-thread.txt',
            mimeType: 'text/plain',
            mode: 'download',
        });
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download_url' });
    });

    it('should use the Cursor workspace path when naming ZIP archives', async () => {
        await exportCursorThreadsFn({
            data: {
                composerIds: ['thread-1'],
                includeCommentary: true,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: true,
            },
        });

        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                entries: [expect.objectContaining({ cwd: '/tmp/one', sessionId: 'thread-1' })],
                fallbackBaseName: 'cursor',
                platform: 'cursor',
            }),
        );
    });

    it('should forward every single-thread export option to the renderer', async () => {
        const result = await exportCursorThreadFn({
            data: {
                composerId: 'thread-1',
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'txt',
                zipArchive: false,
            },
        });

        expect(renderCursorTranscriptMock).toHaveBeenCalledWith(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });
        expect(result).toMatchObject({ content: 'rendered transcript', mode: 'download' });
        expect(result.fileName).toMatch(/\.txt$/u);
        expect(findCursorTranscriptDirsForComposerIdsMock).toHaveBeenCalledWith(['thread-1']);
        expect(readCursorThreadTranscriptWithAgentFilesMock).toHaveBeenCalledWith(
            '/tmp/global.db',
            'thread-1',
            undefined,
            ['/tmp/transcript'],
        );
        expect(renderSourceSessionDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ outputFormat: 'txt', sessionId: 'thread-1', zipArchive: false }),
        );
    });

    it('should forward every batch export option to the renderer', async () => {
        await exportCursorThreadsFn({
            data: {
                composerIds: ['thread-1'],
                includeCommentary: true,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: false,
            },
        });

        expect(renderCursorTranscriptMock).toHaveBeenCalledWith(transcript, {
            includeCommentary: true,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'md',
        });
    });

    it('should use thread titles for files inside batch ZIP exports', async () => {
        readCursorThreadTranscriptWithAgentFilesMock.mockResolvedValueOnce(transcript).mockResolvedValueOnce({
            ...transcript,
            head: { ...transcript.head, composerId: 'thread-2', name: 'Thread two' },
        });

        await exportCursorThreadsFn({
            data: {
                composerIds: ['thread-1', 'thread-2'],
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                zipArchive: true,
            },
        });

        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                entries: [
                    expect.objectContaining({ fileBaseName: 'Thread one', sessionId: 'thread-1' }),
                    expect.objectContaining({ fileBaseName: 'Thread two', sessionId: 'thread-2' }),
                ],
                outputFormat: 'md',
                zipArchive: true,
            }),
        );
    });
});
