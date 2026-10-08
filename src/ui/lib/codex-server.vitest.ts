import { CodexTranscriptHistoryError } from '@spiracha/lib/codex-thread-parser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    createCodexForkedThreadResolverMock,
    getCachedParsedCodexTranscriptMock,
    getCachedCodexTranscriptModelNamesMock,
    getCachedThreadTranscriptPreviewMock,
    getThreadBrowseDataMock,
    getThreadRolloutLoadStateMock,
    renderCodexThreadDownloadMock,
    renderCodexThreadsDownloadMock,
    resolveCodexThreadDbPathMock,
} = vi.hoisted(() => ({
    createCodexForkedThreadResolverMock: vi.fn(),
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
    createCodexForkedThreadResolver: createCodexForkedThreadResolverMock,
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
    exportRawThreadsFn,
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
        createCodexForkedThreadResolverMock.mockReturnValue(vi.fn());
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
        expect(getCachedCodexTranscriptModelNamesMock).toHaveBeenCalledWith('/tmp/rollout.jsonl', {
            resolveForkedThread: expect.any(Function),
        });
        expect(getCachedParsedCodexTranscriptMock).not.toHaveBeenCalled();
        expect(getCachedThreadTranscriptPreviewMock).not.toHaveBeenCalled();
    });

    it('should return browse metadata when Codex fork history is unavailable', async () => {
        getThreadBrowseDataMock.mockReturnValue({
            thread: {
                rollout_path: '/tmp/rollout.jsonl',
            },
        });
        getThreadRolloutLoadStateMock
            .mockRejectedValueOnce(new CodexTranscriptHistoryError('missing fork parent'))
            .mockResolvedValueOnce({
                fileSizeBytes: 42,
                shouldDeferTranscriptLoad: false,
            });

        const snapshot = await getThreadSnapshotFn({ data: { threadId: 'thread-1' } });

        expect(snapshot).toMatchObject({
            modelNames: [],
            rollout: {
                fileSizeBytes: 42,
                shouldDeferTranscriptLoad: false,
            },
            thread: {
                rollout_path: '/tmp/rollout.jsonl',
            },
            transcript: null,
            transcriptState: 'unavailable',
        });
        expect(getThreadRolloutLoadStateMock).toHaveBeenNthCalledWith(2, '/tmp/rollout.jsonl');
        expect(getCachedCodexTranscriptModelNamesMock).not.toHaveBeenCalled();
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
            resolveForkedThread: expect.any(Function),
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
        expect(getCachedParsedCodexTranscriptMock).toHaveBeenCalledWith('/tmp/rollout.jsonl', {
            resolveForkedThread: expect.any(Function),
        });
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

    it('should export selected Codex rollout files as raw JSON', async () => {
        renderCodexThreadsDownloadMock.mockResolvedValue({
            downloadUrl: '/__exports/raw.zip',
            fileName: 'codex-threads.zip',
            mimeType: 'application/zip',
            mode: 'download_url',
        });

        await exportRawThreadsFn({ data: { threadIds: ['thread-1', 'thread-2'] } });

        expect(renderCodexThreadsDownloadMock).toHaveBeenCalledWith({
            dbPath: '/tmp/state.sqlite',
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'json',
            threadIds: ['thread-1', 'thread-2'],
            zipArchive: true,
        });
    });

    it('should leave a single raw Codex JSON file unzipped unless a zip is requested', async () => {
        renderCodexThreadDownloadMock.mockResolvedValue({
            content: '{}',
            fileName: 'thread-1.json',
            mimeType: 'application/json',
            mode: 'download',
        });

        await exportRawThreadsFn({ data: { threadIds: ['thread-1'] } });

        expect(renderCodexThreadDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ outputFormat: 'json', threadId: 'thread-1', zipArchive: false }),
        );
    });

    it('should zip a single raw Codex JSON file with the requested password', async () => {
        renderCodexThreadDownloadMock.mockResolvedValue({
            downloadUrl: '/__exports/raw.zip',
            fileName: 'thread-1.zip',
            mimeType: 'application/zip',
            mode: 'download_url',
        });

        await exportRawThreadsFn({ data: { threadIds: ['thread-1'], zipArchive: true, zipPassword: 'pw' } });

        expect(renderCodexThreadDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                outputFormat: 'json',
                threadId: 'thread-1',
                zipArchive: true,
                zipPassword: 'pw',
            }),
        );
    });

    it('should pass the timestamps option through to single and batch Codex exports', async () => {
        renderCodexThreadDownloadMock.mockResolvedValue({
            content: '',
            fileName: 'a.md',
            mimeType: 'text/markdown',
            mode: 'download',
        });
        renderCodexThreadsDownloadMock.mockResolvedValue({
            downloadUrl: '/x.zip',
            fileName: 'x.zip',
            mimeType: 'application/zip',
            mode: 'download_url',
        });
        const base = {
            convertToProjectRoot: false,
            includeCommentary: true,
            includeMetadata: true,
            includeTimestamps: true,
            includeTools: true,
            outputFormat: 'md' as const,
            redactUsername: false,
        };

        await exportThreadFn({ data: { ...base, threadId: 'thread-1', zipArchive: false, zipPassword: '' } });
        await exportThreadsFn({
            data: { ...base, threadIds: ['thread-1', 'thread-2'], zipArchive: true, zipPassword: '' },
        });

        expect(renderCodexThreadDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ includeTimestamps: true }),
        );
        expect(renderCodexThreadsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ includeTimestamps: true }),
        );
    });
});
