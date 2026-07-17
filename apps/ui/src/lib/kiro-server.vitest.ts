import type { KiroSessionTranscript } from '@spiracha/lib/kiro-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    readKiroSessionTranscriptMock,
    renderKiroTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveKiroWorkspaceSessionsDirMock,
} = vi.hoisted(() => ({
    readKiroSessionTranscriptMock: vi.fn(),
    renderKiroTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveKiroWorkspaceSessionsDirMock: vi.fn(),
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

vi.mock('@spiracha/lib/kiro-db', () => ({
    deleteKiroSession: vi.fn(),
    listKiroSessionsForGroup: vi.fn(),
    listKiroWorkspaceGroups: vi.fn(),
    readKiroSessionTranscript: readKiroSessionTranscriptMock,
    resolveKiroWorkspaceSessionsDir: resolveKiroWorkspaceSessionsDirMock,
}));

vi.mock('@spiracha/lib/kiro-transcript', () => ({
    renderKiroTranscript: renderKiroTranscriptMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import { exportKiroSessionFn, exportKiroSessionsFn } from './kiro-server';

const buildTranscript = (sessionId: string, title: string): KiroSessionTranscript =>
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
    }) as unknown as KiroSessionTranscript;

describe('Kiro server exports', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveKiroWorkspaceSessionsDirMock.mockReturnValue('/tmp/kiro-sessions');
        renderKiroTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionDownloadMock.mockResolvedValue({ mode: 'download' });
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download_url' });
    });

    it('should forward every export option for single and batch Kiro sessions', async () => {
        const first = buildTranscript('session-first', 'First session');
        const second = buildTranscript('session-second', 'Second session');
        readKiroSessionTranscriptMock
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
        await exportKiroSessionFn({ data: { ...options, sessionId: first.session.sessionId } } as never);
        await exportKiroSessionsFn({
            data: { ...options, sessionIds: [first.session.sessionId, second.session.sessionId] },
        } as never);

        expect(renderKiroTranscriptMock).toHaveBeenNthCalledWith(1, first, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
        });
        expect(renderKiroTranscriptMock).toHaveBeenNthCalledWith(2, first, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'txt',
        });
        expect(renderKiroTranscriptMock).toHaveBeenNthCalledWith(3, second, {
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
