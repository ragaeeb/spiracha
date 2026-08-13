import type { MiniMaxCodeSessionTranscript } from '@spiracha/lib/minimax-code-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteMiniMaxCodeSessionMock,
    readMiniMaxCodeSessionTranscriptMock,
    renderMiniMaxCodeTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveMiniMaxCodeSessionsDirMock,
    resolveMiniMaxCodeRuntimeDbPathMock,
} = vi.hoisted(() => ({
    deleteMiniMaxCodeSessionMock: vi.fn(),
    readMiniMaxCodeSessionTranscriptMock: vi.fn(),
    renderMiniMaxCodeTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveMiniMaxCodeRuntimeDbPathMock: vi.fn(),
    resolveMiniMaxCodeSessionsDirMock: vi.fn(),
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

vi.mock('@spiracha/lib/minimax-code-db', () => ({
    deleteMiniMaxCodeSession: deleteMiniMaxCodeSessionMock,
    listMiniMaxCodeSessionsForGroup: vi.fn(),
    listMiniMaxCodeWorkspaceGroups: vi.fn(),
    readMiniMaxCodeSessionTranscript: readMiniMaxCodeSessionTranscriptMock,
    resolveMiniMaxCodeRuntimeDbPath: resolveMiniMaxCodeRuntimeDbPathMock,
    resolveMiniMaxCodeSessionsDir: resolveMiniMaxCodeSessionsDirMock,
}));

vi.mock('@spiracha/lib/minimax-code-transcript', () => ({
    renderMiniMaxCodeTranscript: renderMiniMaxCodeTranscriptMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    deleteMiniMaxCodeSessionFn,
    deleteMiniMaxCodeSessionsFn,
    exportMiniMaxCodeSessionFn,
    exportMiniMaxCodeSessionsFn,
} from './minimax-code-server';

const buildTranscript = (sessionId: string, title: string): MiniMaxCodeSessionTranscript =>
    ({
        messages: [],
        renderablePartCount: 0,
        session: {
            lastActiveAtMs: 1_700_000_000_000,
            sessionId,
            title,
            worktree: '/workspace/project',
        },
    }) as unknown as MiniMaxCodeSessionTranscript;

describe('MiniMax Code server operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveMiniMaxCodeSessionsDirMock.mockReturnValue('/tmp/minimax/v2/sessions');
        resolveMiniMaxCodeRuntimeDbPathMock.mockReturnValue('/tmp/minimax/v2/sqlite/runtime-state.sqlite');
        deleteMiniMaxCodeSessionMock.mockImplementation(async (_sessionsDir, _runtimeDbPath, sessionId) => ({
            deletedFiles: [`/tmp/${sessionId}/snapshot.json`],
            deletedSessionIds: [sessionId],
        }));
        renderMiniMaxCodeTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionDownloadMock.mockResolvedValue({ mode: 'download' });
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download_url' });
    });

    it('should forward every export option for single and batch sessions', async () => {
        const first = buildTranscript('mvs_first', 'First session');
        const second = buildTranscript('mvs_second', 'Second session');
        readMiniMaxCodeSessionTranscriptMock
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

        await exportMiniMaxCodeSessionFn({ data: { ...options, sessionId: first.session.sessionId } } as never);
        await exportMiniMaxCodeSessionsFn({
            data: { ...options, sessionIds: [first.session.sessionId, second.session.sessionId] },
        } as never);

        expect(renderMiniMaxCodeTranscriptMock).toHaveBeenCalledTimes(3);
        expect(renderSourceSessionDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                fallbackBaseName: 'minimax-code-session',
                outputFormat: 'txt',
                zipArchive: true,
            }),
        );
        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                fallbackBaseName: 'minimax-code-sessions',
                outputFormat: 'txt',
                zipArchive: true,
            }),
        );
    });

    it('should reject missing sessions', async () => {
        readMiniMaxCodeSessionTranscriptMock.mockResolvedValueOnce(null);

        await expect(
            exportMiniMaxCodeSessionFn({
                data: {
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    sessionId: 'mvs_missing',
                    zipArchive: false,
                },
            } as never),
        ).rejects.toThrow('MiniMax Code session not found: mvs_missing');
    });

    it('should force ZIP archives for batch exports even when the submitted option is false', async () => {
        const first = buildTranscript('mvs_first', 'First session');
        const second = buildTranscript('mvs_second', 'Second session');
        readMiniMaxCodeSessionTranscriptMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

        await exportMiniMaxCodeSessionsFn({
            data: {
                includeCommentary: true,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
                sessionIds: [first.session.sessionId, second.session.sessionId],
                zipArchive: false,
            },
        } as never);

        expect(renderSourceSessionsDownloadMock).toHaveBeenCalledWith(expect.objectContaining({ zipArchive: true }));
    });

    it('should delete one or multiple MiniMax Code sessions from the resolved v2 stores', async () => {
        await deleteMiniMaxCodeSessionFn({ data: { sessionId: 'mvs_first' } } as never);
        await deleteMiniMaxCodeSessionsFn({ data: { sessionIds: ['mvs_first', 'mvs_second'] } } as never);

        expect(deleteMiniMaxCodeSessionMock).toHaveBeenCalledWith(
            '/tmp/minimax/v2/sessions',
            '/tmp/minimax/v2/sqlite/runtime-state.sqlite',
            'mvs_first',
        );
        expect(deleteMiniMaxCodeSessionMock).toHaveBeenCalledWith(
            '/tmp/minimax/v2/sessions',
            '/tmp/minimax/v2/sqlite/runtime-state.sqlite',
            'mvs_second',
        );
    });
});
