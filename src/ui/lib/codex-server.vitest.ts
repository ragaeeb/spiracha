import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getCachedParsedCodexTranscriptMock,
    getCachedCodexTranscriptModelNamesMock,
    getCachedThreadTranscriptPreviewMock,
    getThreadBrowseDataMock,
    getThreadRolloutLoadStateMock,
    renderCodexThreadDownloadMock,
    renderCodexThreadsDownloadMock,
    resolveCodexThreadDbPathMock,
} = vi.hoisted(() => ({
    getCachedCodexTranscriptModelNamesMock: vi.fn(),
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

vi.mock('@spiracha/lib/codex-browser-queries', () => ({
    getThreadBrowseData: getThreadBrowseDataMock,
    listCodexProjects: vi.fn(),
    listProjectThreads: vi.fn(),
}));

vi.mock('@spiracha/lib/codex-database', () => ({
    resolveCodexThreadDbPath: resolveCodexThreadDbPathMock,
}));

vi.mock('@spiracha/lib/codex-dashboard', () => ({
    getCodexDashboardSummary: vi.fn(),
}));

vi.mock('@spiracha/lib/codex-thread-mutations', () => ({
    deleteCodexProject: vi.fn(),
    deleteCodexThread: vi.fn(),
    deleteCodexThreads: vi.fn(),
}));

vi.mock('@spiracha/lib/codex-browser-export', () => ({
    renderCodexThreadDownload: renderCodexThreadDownloadMock,
    renderCodexThreadsDownload: renderCodexThreadsDownloadMock,
}));

vi.mock('@spiracha/lib/codex-analytics', () => ({
    getCodexAnalytics: vi.fn(),
}));

vi.mock('@spiracha/lib/codex-thread-cache', () => ({
    getCachedCodexTranscriptModelNames: getCachedCodexTranscriptModelNamesMock,
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

    it('should return metadata-only thread snapshots with cached model history', async () => {
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
        getCachedCodexTranscriptModelNamesMock.mockResolvedValue(['gpt-5.6-sol', 'gpt-5.6-terra']);

        const snapshot = await getThreadSnapshotFn({ data: { threadId: 'thread-1' } });

        expect(snapshot).toMatchObject({
            availableTools: [{ description: 'tool', name: 'shell', namespace: null }],
            modelNames: ['gpt-5.6-sol', 'gpt-5.6-terra'],
            rollout: {
                fileSizeBytes: 123,
                shouldDeferTranscriptLoad: false,
            },
            transcript: null,
            transcriptState: 'available',
        });
        expect(getCachedCodexTranscriptModelNamesMock).toHaveBeenCalledWith('/tmp/rollout.jsonl');
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
