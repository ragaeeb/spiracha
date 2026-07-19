import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getCachedParsedCodexTranscriptMock,
    getCachedThreadTranscriptPreviewMock,
    getThreadBrowseDataMock,
    getThreadRolloutLoadStateMock,
    renderCodexThreadDownloadMock,
    renderCodexThreadsDownloadMock,
    resolveCodexThreadDbPathMock,
} = vi.hoisted(() => ({
    getCachedParsedCodexTranscriptMock: vi.fn(),
    getCachedThreadTranscriptPreviewMock: vi.fn(),
    getThreadBrowseDataMock: vi.fn(),
    getThreadRolloutLoadStateMock: vi.fn(),
    renderCodexThreadDownloadMock: vi.fn(),
    renderCodexThreadsDownloadMock: vi.fn(),
    resolveCodexThreadDbPathMock: vi.fn(),
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

vi.mock('@spiracha/lib/codex-browser-db', () => ({
    deleteCodexProject: vi.fn(),
    deleteCodexThread: vi.fn(),
    deleteCodexThreads: vi.fn(),
    getCodexDashboardSummary: vi.fn(),
    getThreadBrowseData: getThreadBrowseDataMock,
    listCodexProjects: vi.fn(),
    listProjectThreads: vi.fn(),
    resolveCodexThreadDbPath: resolveCodexThreadDbPathMock,
}));

vi.mock('@spiracha/lib/codex-browser-export', () => ({
    renderCodexThreadDownload: renderCodexThreadDownloadMock,
    renderCodexThreadsDownload: renderCodexThreadsDownloadMock,
}));

vi.mock('@spiracha/lib/codex-analytics', () => ({
    getCodexAnalytics: vi.fn(),
}));

vi.mock('@spiracha/lib/codex-thread-cache', () => ({
    getCachedParsedCodexTranscript: getCachedParsedCodexTranscriptMock,
    getCachedThreadTranscriptPreview: getCachedThreadTranscriptPreviewMock,
    getThreadRolloutLoadState: getThreadRolloutLoadStateMock,
}));

vi.mock('@spiracha/lib/codex-thread-recovery', () => ({
    recoverCodexProjectThreads: vi.fn(),
}));

import {
    exportThreadFn,
    exportThreadsFn,
    getThreadSnapshotFn,
    loadThreadTranscript,
    loadThreadTranscriptPreview,
} from './codex-server';

describe('loadThreadTranscript', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveCodexThreadDbPathMock.mockReturnValue('/tmp/state.sqlite');
    });

    it('should return metadata-only thread snapshots without parsing transcript contents', async () => {
        getThreadBrowseDataMock.mockReturnValue({
            dynamicTools: [{ description: 'tool', name: 'shell', namespace: null }],
            project: 'project-1',
            relations: { childEdges: [], parentThreadId: null },
            thread: {
                rollout_path: '/tmp/rollout.jsonl',
            },
        });
        getThreadRolloutLoadStateMock.mockResolvedValue({
            fileSizeBytes: 123,
            shouldDeferTranscriptLoad: false,
        });

        const snapshot = await getThreadSnapshotFn({ data: { threadId: 'thread-1' } });

        expect(snapshot).toMatchObject({
            availableTools: [{ description: 'tool', name: 'shell', namespace: null }],
            rollout: {
                fileSizeBytes: 123,
                shouldDeferTranscriptLoad: false,
            },
            transcript: null,
            transcriptState: 'available',
        });
        expect(getCachedParsedCodexTranscriptMock).not.toHaveBeenCalled();
        expect(getCachedThreadTranscriptPreviewMock).not.toHaveBeenCalled();
    });

    it('should load transcript previews through the explicit preview endpoint', async () => {
        const transcript = {
            events: [{ kind: 'message' }],
            isPartial: true,
            rawIncluded: false,
            sessionMeta: {},
            sourceFileSizeBytes: 1000,
            stats: {},
            statsArePartial: true,
            turnContexts: [],
        };
        getThreadBrowseDataMock.mockReturnValue({
            thread: {
                rollout_path: '/tmp/rollout.jsonl',
            },
        });
        getCachedThreadTranscriptPreviewMock.mockResolvedValue(transcript);

        await expect(loadThreadTranscriptPreview('thread-1')).resolves.toBe(transcript);

        expect(getThreadBrowseDataMock).toHaveBeenCalledWith('/tmp/state.sqlite', 'thread-1');
        expect(getCachedThreadTranscriptPreviewMock).toHaveBeenCalledWith('/tmp/rollout.jsonl', {
            filters: undefined,
        });
    });

    it('should load the full parsed transcript for explicit thread detail requests', async () => {
        const transcript = {
            events: [],
            isPartial: false,
            rawIncluded: true,
            sessionMeta: {},
            sourceFileSizeBytes: null,
            stats: {},
            statsArePartial: false,
            turnContexts: [],
        };
        getThreadBrowseDataMock.mockReturnValue({
            thread: {
                rollout_path: '/tmp/rollout.jsonl',
            },
        });
        getCachedParsedCodexTranscriptMock.mockResolvedValue(transcript);

        await expect(loadThreadTranscript('thread-1')).resolves.toBe(transcript);

        expect(getThreadBrowseDataMock).toHaveBeenCalledWith('/tmp/state.sqlite', 'thread-1');
        expect(getCachedParsedCodexTranscriptMock).toHaveBeenCalledWith('/tmp/rollout.jsonl');
    });

    it('should forward every export dialog option for single and batch Codex exports', async () => {
        const options = {
            convertToProjectRoot: true,
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt' as const,
            redactUsername: true,
            zipArchive: true,
        };

        await exportThreadFn({
            data: {
                ...options,
                threadId: 'thread-1',
            },
        });
        await exportThreadsFn({
            data: {
                ...options,
                threadIds: ['thread-1', 'thread-2'],
            },
        });

        expect(renderCodexThreadDownloadMock).toHaveBeenCalledWith({
            dbPath: '/tmp/state.sqlite',
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
            pathDisplaySettings: {
                convertToProjectRoot: true,
                redactUsername: true,
            },
            threadId: 'thread-1',
            zipArchive: true,
        });
        expect(renderCodexThreadsDownloadMock).toHaveBeenCalledWith({
            dbPath: '/tmp/state.sqlite',
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
            pathDisplaySettings: {
                convertToProjectRoot: true,
                redactUsername: true,
            },
            threadIds: ['thread-1', 'thread-2'],
            zipArchive: true,
        });
    });
});
