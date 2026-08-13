import type { GrokSessionTranscript } from '@spiracha/lib/grok-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteGrokSessionMock,
    readGrokSessionTranscriptMock,
    renderGrokTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveGrokSessionsDirMock,
} = vi.hoisted(() => ({
    deleteGrokSessionMock: vi.fn(),
    readGrokSessionTranscriptMock: vi.fn(),
    renderGrokTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveGrokSessionsDirMock: vi.fn(),
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

vi.mock('@spiracha/lib/grok-db', () => ({
    deleteGrokSession: deleteGrokSessionMock,
    listGrokSessionsForGroup: vi.fn(),
    listGrokWorkspaceGroups: vi.fn(),
    readGrokSessionTranscript: readGrokSessionTranscriptMock,
    resolveGrokSessionsDir: resolveGrokSessionsDirMock,
}));

vi.mock('@spiracha/lib/grok-transcript', () => ({
    renderGrokTranscript: renderGrokTranscriptMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import { deleteGrokSessionFn, deleteGrokSessionsFn, exportGrokSessionFn, exportGrokSessionsFn } from './grok-server';

const buildTranscript = (sessionId: string, title: string): GrokSessionTranscript =>
    ({
        entries: [],
        rawEvents: [],
        renderablePartCount: 0,
        session: {
            cwd: '/workspace/project',
            lastActiveAtMs: 1_700_000_000_000,
            sessionId,
            title,
            worktree: '/workspace/project',
        },
    }) as unknown as GrokSessionTranscript;

describe('Grok server operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveGrokSessionsDirMock.mockReturnValue('/tmp/grok-sessions');
        renderGrokTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionDownloadMock.mockResolvedValue({ mode: 'download' });
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download_url' });
    });

    it('should forward every export option for single and batch Grok sessions', async () => {
        const first = buildTranscript('session-first', 'First session');
        const second = buildTranscript('session-second', 'Second session');
        readGrokSessionTranscriptMock
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

        await exportGrokSessionFn({ data: { ...options, sessionId: first.session.sessionId } } as never);
        await exportGrokSessionsFn({
            data: { ...options, sessionIds: [first.session.sessionId, second.session.sessionId] },
        } as never);

        expect(renderGrokTranscriptMock).toHaveBeenCalledTimes(3);
        for (const transcript of [first, first, second]) {
            expect(renderGrokTranscriptMock).toHaveBeenCalledWith(transcript, {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'txt',
            });
        }
        expect(renderSourceSessionDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ outputFormat: 'txt', zipArchive: true }),
        );
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ outputFormat: 'txt', zipArchive: true }),
        );
    });

    it('should aggregate bulk deletes and reject missing single sessions', async () => {
        deleteGrokSessionMock
            .mockResolvedValueOnce({ deletedFiles: ['/tmp/first.jsonl'], deletedSessionIds: ['first'] })
            .mockResolvedValueOnce({ deletedFiles: ['/tmp/second.jsonl'], deletedSessionIds: ['second'] });

        await expect(deleteGrokSessionsFn({ data: { sessionIds: ['first', 'second'] } } as never)).resolves.toEqual({
            deletedFiles: ['/tmp/first.jsonl', '/tmp/second.jsonl'],
            deletedSessionIds: ['first', 'second'],
        });

        deleteGrokSessionMock.mockResolvedValueOnce({ deletedFiles: [], deletedSessionIds: [] });
        await expect(deleteGrokSessionFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
            'Grok session not found: missing',
        );
    });
});
