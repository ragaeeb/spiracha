import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCachedParsedCodexTranscriptMock, getThreadBrowseDataMock, resolveCodexThreadDbPathMock } = vi.hoisted(
    () => ({
        getCachedParsedCodexTranscriptMock: vi.fn(),
        getThreadBrowseDataMock: vi.fn(),
        resolveCodexThreadDbPathMock: vi.fn(),
    }),
);

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
    renderCodexThreadDownload: vi.fn(),
    renderCodexThreadsDownload: vi.fn(),
}));

vi.mock('@spiracha/lib/codex-analytics', () => ({
    getCodexAnalytics: vi.fn(),
}));

vi.mock('@spiracha/lib/codex-thread-cache', () => ({
    getCachedParsedCodexTranscript: getCachedParsedCodexTranscriptMock,
    getThreadRolloutLoadState: vi.fn(),
}));

vi.mock('@spiracha/lib/codex-thread-recovery', () => ({
    recoverCodexProjectThreads: vi.fn(),
}));

import { loadThreadTranscript } from './codex-server';

describe('loadThreadTranscript', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveCodexThreadDbPathMock.mockReturnValue('/tmp/state.sqlite');
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
});
