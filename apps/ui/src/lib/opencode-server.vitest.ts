import type { OpenCodeSessionTranscript } from '@spiracha/lib/opencode-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteOpenCodeSessionMock,
    listOpenCodeSessionsForGroupMock,
    listOpenCodeWorkspaceGroupsMock,
    readOpenCodeSessionTranscriptMock,
    renderOpenCodeTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
} = vi.hoisted(() => ({
    deleteOpenCodeSessionMock: vi.fn(),
    listOpenCodeSessionsForGroupMock: vi.fn(),
    listOpenCodeWorkspaceGroupsMock: vi.fn(),
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
    deleteOpenCodeSession: deleteOpenCodeSessionMock,
    listOpenCodeSessionsForGroup: listOpenCodeSessionsForGroupMock,
    listOpenCodeWorkspaceGroups: listOpenCodeWorkspaceGroupsMock,
    readOpenCodeSessionTranscript: readOpenCodeSessionTranscriptMock,
    resolveOpenCodeDbPath: vi.fn(() => '/tmp/opencode.db'),
}));

vi.mock('@spiracha/lib/opencode-transcript', () => ({
    renderOpenCodeTranscript: renderOpenCodeTranscriptMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    deleteOpenCodeSessionFn,
    deleteOpenCodeSessionsFn,
    exportOpenCodeSessionFn,
    exportOpenCodeSessionsFn,
    getOpenCodeSessionDetailFn,
    listOpenCodeSessionsFn,
    listOpenCodeWorkspacesFn,
} from './opencode-server';

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

    it('should list, load, and delete OpenCode sessions through the source database', async () => {
        listOpenCodeWorkspaceGroupsMock.mockResolvedValue(['workspace']);
        listOpenCodeSessionsForGroupMock.mockResolvedValue(['session']);
        deleteOpenCodeSessionMock.mockResolvedValue(true);

        await expect(listOpenCodeWorkspacesFn({} as never)).resolves.toEqual(['workspace']);
        await expect(listOpenCodeSessionsFn({ data: { workspaceKey: 'workspace-a' } } as never)).resolves.toEqual([
            'session',
        ]);
        await expect(getOpenCodeSessionDetailFn({ data: { sessionId: 'session-1' } } as never)).resolves.toBe(
            transcript,
        );
        await expect(deleteOpenCodeSessionFn({ data: { sessionId: 'session-1' } } as never)).resolves.toBe(true);
        await expect(
            deleteOpenCodeSessionsFn({ data: { sessionIds: ['session-1', 'session-2'] } } as never),
        ).resolves.toEqual([true, true]);

        expect(listOpenCodeSessionsForGroupMock).toHaveBeenCalledWith('workspace-a');
        expect(deleteOpenCodeSessionMock).toHaveBeenCalledTimes(3);
    });

    it('should reject missing and empty OpenCode session exports', async () => {
        readOpenCodeSessionTranscriptMock.mockResolvedValueOnce(null);
        await expect(getOpenCodeSessionDetailFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
            'OpenCode session not found: missing',
        );

        readOpenCodeSessionTranscriptMock.mockResolvedValue(transcript);
        renderOpenCodeTranscriptMock.mockReturnValue('');
        await expect(
            exportOpenCodeSessionFn({
                data: {
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    sessionId: 'session-1',
                    zipArchive: false,
                },
            }),
        ).rejects.toThrow('OpenCode session has no exportable content: session-1');
        await expect(
            exportOpenCodeSessionsFn({
                data: {
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    sessionIds: ['session-1'],
                    zipArchive: true,
                },
            }),
        ).rejects.toThrow('OpenCode session has no exportable content: session-1');
    });
});
