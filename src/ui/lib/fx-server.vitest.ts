import type { FxSessionTranscript } from '@spiracha/lib/fx-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteFxSessionMock,
    readFxSessionTranscriptMock,
    renderFxTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveFxDataDirMock,
} = vi.hoisted(() => ({
    deleteFxSessionMock: vi.fn(),
    readFxSessionTranscriptMock: vi.fn(),
    renderFxTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveFxDataDirMock: vi.fn(),
}));

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        const serverFn = { handler: (callback: unknown) => callback, validator: () => serverFn };
        return serverFn;
    },
}));

vi.mock('@spiracha/lib/fx-db', () => ({
    deleteFxSession: deleteFxSessionMock,
    listFxSessionsForGroup: vi.fn(),
    listFxWorkspaceGroups: vi.fn(),
    readFxSessionTranscript: readFxSessionTranscriptMock,
    resolveFxDataDir: resolveFxDataDirMock,
}));

vi.mock('@spiracha/lib/fx-transcript', () => ({ renderFxTranscript: renderFxTranscriptMock }));
vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));
vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import { deleteFxSessionFn, deleteFxSessionsFn, exportFxSessionFn, exportFxSessionsFn } from './fx-server';

const buildTranscript = (sessionId: string, title: string): FxSessionTranscript =>
    ({
        messages: [],
        renderablePartCount: 1,
        session: {
            lastActiveAtMs: 1_700_000_000_000,
            sessionId,
            title,
            worktree: '/workspace/project',
        },
    }) as unknown as FxSessionTranscript;

describe('FX server operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveFxDataDirMock.mockReturnValue('/tmp/.fx');
        deleteFxSessionMock.mockImplementation(async (_dataDir, sessionId) => ({
            deletedFiles: [`/tmp/.fx/sessions/${sessionId}`],
            deletedSessionIds: [sessionId],
        }));
        renderFxTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionDownloadMock.mockResolvedValue({ mode: 'download' });
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download_url' });
    });

    it('should forward export options for single and batch sessions', async () => {
        const first = buildTranscript('first', 'First session');
        const second = buildTranscript('second', 'Second session');
        readFxSessionTranscriptMock
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

        await exportFxSessionFn({ data: { ...options, sessionId: 'first' } } as never);
        await exportFxSessionsFn({ data: { ...options, sessionIds: ['first', 'second'] } } as never);

        expect(renderFxTranscriptMock).toHaveBeenCalledTimes(3);
        expect(renderSourceSessionDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({ fallbackBaseName: 'fx-session', outputFormat: 'txt', platform: 'fx' }),
        );
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                fallbackBaseName: 'fx-sessions',
                outputFormat: 'txt',
                platform: 'fx',
                zipArchive: true,
            }),
        );
    });

    it('should surface missing sessions instead of exporting an empty transcript', async () => {
        readFxSessionTranscriptMock.mockResolvedValueOnce(null);

        await expect(
            exportFxSessionFn({
                data: {
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    sessionId: 'missing',
                    zipArchive: false,
                },
            } as never),
        ).rejects.toThrow('FX session not found: missing');
    });

    it('should delete single and batch sessions from the resolved FX store', async () => {
        await deleteFxSessionFn({ data: { sessionId: 'first' } } as never);
        await deleteFxSessionsFn({ data: { sessionIds: ['first', 'second'] } } as never);

        expect(deleteFxSessionMock).toHaveBeenCalledWith('/tmp/.fx', 'first');
        expect(deleteFxSessionMock).toHaveBeenCalledWith('/tmp/.fx', 'second');
    });
});
