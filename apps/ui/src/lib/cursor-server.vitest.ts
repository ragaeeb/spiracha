import type { CursorThreadSummary, CursorWorkspaceGroup } from '@spiracha/lib/cursor-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listCursorThreadsForGroupMock, listCursorWorkspaceGroupsMock } = vi.hoisted(() => ({
    listCursorThreadsForGroupMock: vi.fn(),
    listCursorWorkspaceGroupsMock: vi.fn(),
}));

vi.mock('@spiracha/lib/cursor-db', () => ({
    listCursorThreadsForGroup: listCursorThreadsForGroupMock,
    listCursorWorkspaceGroups: listCursorWorkspaceGroupsMock,
    readCursorThreadTranscript: vi.fn(),
}));

vi.mock('@spiracha/lib/cursor-exporter-types', () => ({
    getCursorGlobalDbPath: vi.fn(() => '/tmp/global.db'),
}));

vi.mock('@spiracha/lib/cursor-recovery', () => ({
    collectCursorThreadsForDeletion: vi.fn(),
    isCursorRunning: vi.fn(),
    pruneCursorThreads: vi.fn(),
    recoverCursorWorkspaceGroup: vi.fn(),
}));

vi.mock('@spiracha/lib/cursor-transcript', () => ({
    renderCursorTranscript: vi.fn(),
}));

import { findCursorThreadByComposerId } from './cursor-server';

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

describe('findCursorThreadByComposerId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
