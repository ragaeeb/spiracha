import type { OpenCodeSessionTranscript } from '@spiracha/lib/opencode-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    readOpenCodeSessionTranscriptMock,
    renderOpenCodeTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
} = vi.hoisted(() => ({
    readOpenCodeSessionTranscriptMock: vi.fn(),
    renderOpenCodeTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
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

vi.mock('@spiracha/lib/opencode-db', () => ({
    readOpenCodeSessionTranscript: readOpenCodeSessionTranscriptMock,
    resolveOpenCodeDbPath: vi.fn(() => '/tmp/opencode.db'),
}));

vi.mock('@spiracha/lib/opencode-transcript', () => ({
    renderOpenCodeTranscript: renderOpenCodeTranscriptMock,
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import { exportOpenCodeSessionFn, exportOpenCodeSessionsFn } from './opencode-server';

const transcript = {
    messages: [],
    partCount: 0,
    renderablePartCount: 0,
    session: {
        lastUpdatedAtMs: 1_700_000_100_000,
        sessionId: 'session-1',
        slug: 'session-one',
        title: 'Session one',
        worktree: '/repo',
    },
} as unknown as OpenCodeSessionTranscript;

describe('OpenCode export server functions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        readOpenCodeSessionTranscriptMock.mockResolvedValue(transcript);
        renderOpenCodeTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionDownloadMock.mockResolvedValue({ mode: 'download' });
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download' });
    });

    it('should forward every single-session export option to the renderer and download helper', async () => {
        await exportOpenCodeSessionFn({
            data: {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'txt',
                sessionId: 'session-1',
                zipArchive: true,
            },
        });

        expect(renderOpenCodeTranscriptMock).toHaveBeenCalledWith(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });
        expect(renderSourceSessionDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ outputFormat: 'txt', sessionId: 'session-1', zipArchive: true }),
        );
    });

    it('should forward every batch export option to the renderer and download helper', async () => {
        await exportOpenCodeSessionsFn({
            data: {
                includeCommentary: true,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'md',
                sessionIds: ['session-1'],
                zipArchive: false,
            },
        });

        expect(renderOpenCodeTranscriptMock).toHaveBeenCalledWith(transcript, {
            includeCommentary: true,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'md',
        });
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ outputFormat: 'md', zipArchive: false }),
        );
    });
});
