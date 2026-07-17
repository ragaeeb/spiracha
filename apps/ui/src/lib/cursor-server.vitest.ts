import type {
    CursorThreadSummary,
    CursorThreadTranscript,
    CursorWorkspaceGroup,
} from '@spiracha/lib/cursor-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    collectCursorThreadsForDeletionMock,
    isCursorRunningMock,
    listCursorThreadsForGroupMock,
    listCursorWorkspaceGroupsMock,
    pruneCursorThreadsMock,
    readCursorThreadTranscriptWithAgentFilesMock,
    recoverCursorWorkspaceGroupMock,
    renderCursorTranscriptMock,
    renderSourceSessionsDownloadMock,
} = vi.hoisted(() => ({
    collectCursorThreadsForDeletionMock: vi.fn(),
    isCursorRunningMock: vi.fn(),
    listCursorThreadsForGroupMock: vi.fn(),
    listCursorWorkspaceGroupsMock: vi.fn(),
    pruneCursorThreadsMock: vi.fn(),
    readCursorThreadTranscriptWithAgentFilesMock: vi.fn(),
    recoverCursorWorkspaceGroupMock: vi.fn(),
    renderCursorTranscriptMock: vi.fn(),
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

vi.mock('@spiracha/lib/cursor-db', () => ({
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
    isCursorRunning: isCursorRunningMock,
    pruneCursorThreads: pruneCursorThreadsMock,
    recoverCursorWorkspaceGroup: recoverCursorWorkspaceGroupMock,
}));

vi.mock('@spiracha/lib/cursor-transcript', () => ({
    renderCursorTranscript: renderCursorTranscriptMock,
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    deleteCursorThreadsFn,
    deleteCursorWorkspaceFn,
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

const makeThread = (overrides: Partial<CursorThreadSummary> = {}): CursorThreadSummary => ({
    bubbleBytes: 128,
    bubbleCount: 3,
    bucketId: 'bucket-1',
    composerId: 'thread-1',
    createdAtMs: 1_700_000_000_000,
    lastUpdatedAtMs: 1_700_000_100_000,
    mode: 'agent',
    name: 'Thread one',
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
});

describe('deleteCursorWorkspaceFn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isCursorRunningMock.mockResolvedValue(false);
    });

    it('should delete every Cursor thread in a workspace', async () => {
        const workspaceThreads = [makeThread(), makeThread({ composerId: 'thread-2' })];
        const deletableThreads = workspaceThreads.map((thread) => ({ composerId: thread.composerId }));
        const result = {
            bubblesDeleted: 5,
            composerDataDeleted: 2,
            composerIds: ['thread-1', 'thread-2'],
            headersRemoved: 2,
            transcriptDirsRemoved: 2,
            workspaceBucketsUpdated: 1,
        };
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne]);
        listCursorThreadsForGroupMock.mockResolvedValue(workspaceThreads);
        collectCursorThreadsForDeletionMock.mockResolvedValue(deletableThreads);
        pruneCursorThreadsMock.mockResolvedValue(result);

        await expect(deleteCursorWorkspaceFn({ data: { workspaceKey: workspaceOne.key } })).resolves.toBe(result);

        expect(listCursorThreadsForGroupMock).toHaveBeenCalledWith(workspaceOne, undefined, {
            includeTranscriptDirs: false,
        });
        expect(collectCursorThreadsForDeletionMock).toHaveBeenCalledWith(['thread-1', 'thread-2']);
        expect(pruneCursorThreadsMock).toHaveBeenCalledWith(deletableThreads, true);
    });
});

describe('Cursor export server functions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listCursorWorkspaceGroupsMock.mockResolvedValue([workspaceOne]);
        readCursorThreadTranscriptWithAgentFilesMock.mockResolvedValue(transcript);
        renderCursorTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download_url' });
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
