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
        deleteCursorWorkspaceBucketsMock.mockResolvedValue(1);

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
            composerDataDeleted: 0,
            composerIds: [],
            headersRemoved: 0,
            transcriptDirsRemoved: 0,
            workspaceBucketsUpdated: 0,
        };
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne]);
        listCursorThreadsForGroupMock.mockResolvedValue([]);
        deleteCursorWorkspaceBucketsMock.mockResolvedValue(1);

        await expect(deleteCursorWorkspaceFn({ data: { workspaceKey: workspaceOne.key } })).resolves.toEqual(result);

        expect(collectCursorThreadsForDeletionMock).not.toHaveBeenCalled();
        expect(pruneCursorThreadsMock).not.toHaveBeenCalled();
        expect(deleteCursorWorkspaceBucketsMock).toHaveBeenCalledWith(workspaceOne);
        expect(deleteCursorWorkspaceHistoryMock).toHaveBeenCalledWith(workspaceOne);
    });
});

describe('deleteCursorWorkspacesFn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isCursorRunningMock.mockResolvedValue(false);
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
        ).resolves.toEqual([workspaceOneResult, workspaceTwoResult]);

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
