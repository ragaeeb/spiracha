import type { QoderSessionTranscript } from '@spiracha/lib/qoder-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    readQoderSessionTranscriptMock,
    renderQoderTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveQoderGlobalStateDbMock,
    resolveQoderWorkspaceStorageDirMock,
} = vi.hoisted(() => ({
    readQoderSessionTranscriptMock: vi.fn(),
    renderQoderTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveQoderGlobalStateDbMock: vi.fn(),
    resolveQoderWorkspaceStorageDirMock: vi.fn(),
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

vi.mock('@spiracha/lib/qoder-db', () => ({
    listQoderSessionsForGroup: vi.fn(),
    listQoderWorkspaceGroups: vi.fn(),
    readQoderSessionTranscript: readQoderSessionTranscriptMock,
    resolveQoderGlobalStateDb: resolveQoderGlobalStateDbMock,
    resolveQoderWorkspaceStorageDir: resolveQoderWorkspaceStorageDirMock,
}));

vi.mock('@spiracha/lib/qoder-transcript', () => ({
    renderQoderTranscript: renderQoderTranscriptMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import { exportQoderSessionFn, exportQoderSessionsFn } from './qoder-server';

const buildTranscript = (sessionId: string, title: string): QoderSessionTranscript =>
    ({
        entries: [],
        rawSession: {},
        renderablePartCount: 0,
        session: {
            lastActiveAtMs: 1_700_000_000_000,
            sessionId,
            title,
            workspacePath: '/workspace/project',
            worktree: '/workspace/project',
        },
    }) as unknown as QoderSessionTranscript;

describe('Qoder server exports', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveQoderGlobalStateDbMock.mockReturnValue('/tmp/qoder-state.vscdb');
        resolveQoderWorkspaceStorageDirMock.mockReturnValue('/tmp/qoder-workspaces');
        renderQoderTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionDownloadMock.mockResolvedValue({ mode: 'download' });
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download_url' });
    });

    it('should forward every export option for single and batch Qoder sessions', async () => {
        const first = buildTranscript('session-first', 'First session');
        const second = buildTranscript('session-second', 'Second session');
        readQoderSessionTranscriptMock
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second);

        const options = {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt' as const,
            zipArchive: true,
        };
        await exportQoderSessionFn({ data: { ...options, sessionId: first.session.sessionId } } as never);
        await exportQoderSessionsFn({
            data: { ...options, sessionIds: [first.session.sessionId, second.session.sessionId] },
        } as never);

        expect(renderQoderTranscriptMock).toHaveBeenNthCalledWith(1, first, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
        });
        expect(renderQoderTranscriptMock).toHaveBeenNthCalledWith(2, first, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
        });
        expect(renderQoderTranscriptMock).toHaveBeenNthCalledWith(3, second, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
        });
        expect(renderSourceSessionDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ outputFormat: 'txt', zipArchive: true }),
        );
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ outputFormat: 'txt', zipArchive: true }),
        );
    });
});
