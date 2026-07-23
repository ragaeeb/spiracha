import type { KiroSessionTranscript } from '@spiracha/lib/kiro-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteKiroSessionMock,
    listKiroSessionsForGroupMock,
    listKiroWorkspaceGroupsMock,
    readKiroSessionTranscriptMock,
    renderKiroTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveKiroWorkspaceSessionsDirMock,
} = vi.hoisted(() => ({
    deleteKiroSessionMock: vi.fn(),
    listKiroSessionsForGroupMock: vi.fn(),
    listKiroWorkspaceGroupsMock: vi.fn(),
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
    deleteKiroSession: deleteKiroSessionMock,
    listKiroSessionsForGroup: listKiroSessionsForGroupMock,
    listKiroWorkspaceGroups: listKiroWorkspaceGroupsMock,
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

import {
    deleteKiroSessionFn,
    deleteKiroSessionsFn,
    exportKiroSessionFn,
    exportKiroSessionsFn,
    getKiroSessionDetailFn,
    listKiroSessionsFn,
    listKiroWorkspacesFn,
} from './kiro-server';

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

    it('should list, load, and delete Kiro sessions through the source database', async () => {
        const transcript = buildTranscript('session-first', 'First session');
        listKiroWorkspaceGroupsMock.mockResolvedValue(['workspace']);
        listKiroSessionsForGroupMock.mockResolvedValue(['session']);
        readKiroSessionTranscriptMock.mockResolvedValue(transcript);
        deleteKiroSessionMock.mockImplementation(async (_sessionsDir: string, sessionId: string) => ({
            deletedFiles: [`${sessionId}.json`],
            deletedSessionIds: [sessionId],
        }));

        await expect(listKiroWorkspacesFn({} as never)).resolves.toEqual(['workspace']);
        await expect(
            listKiroSessionsFn({ data: { merged: true, workspaceKey: 'workspace-a' } } as never),
        ).resolves.toEqual(['session']);
        await expect(
            getKiroSessionDetailFn({ data: { merged: true, sessionId: 'session-first' } } as never),
        ).resolves.toBe(transcript);
        await expect(deleteKiroSessionFn({ data: { sessionId: 'session-first' } } as never)).resolves.toMatchObject({
            deletedSessionIds: ['session-first'],
        });
        await expect(
            deleteKiroSessionsFn({ data: { sessionIds: ['session-first', 'session-second'] } } as never),
        ).resolves.toEqual({
            deletedFiles: ['session-first.json', 'session-second.json'],
            deletedSessionIds: ['session-first', 'session-second'],
        });

        expect(listKiroSessionsForGroupMock).toHaveBeenCalledWith('workspace-a', '/tmp/kiro-sessions', {
            merged: true,
        });
        expect(readKiroSessionTranscriptMock).toHaveBeenCalledWith('/tmp/kiro-sessions', 'session-first', {
            merged: true,
        });
        expect(deleteKiroSessionMock).toHaveBeenCalledTimes(3);
    });

    it('should reject missing and empty Kiro session exports', async () => {
        readKiroSessionTranscriptMock.mockResolvedValueOnce(null);
        await expect(getKiroSessionDetailFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
            'Kiro session not found: missing',
        );
        deleteKiroSessionMock.mockResolvedValueOnce({ deletedFiles: [], deletedSessionIds: [] });
        await expect(deleteKiroSessionFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
            'Kiro session not found: missing',
        );

        readKiroSessionTranscriptMock.mockResolvedValue(buildTranscript('empty', 'Empty'));
        renderKiroTranscriptMock.mockReturnValue('');
        await expect(
            exportKiroSessionFn({
                data: {
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    sessionId: 'empty',
                    zipArchive: false,
                },
            } as never),
        ).rejects.toThrow('Kiro session has no exportable content: empty');
        await expect(
            exportKiroSessionsFn({
                data: {
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    sessionIds: ['empty'],
                    zipArchive: true,
                },
            } as never),
        ).rejects.toThrow('Kiro session has no exportable content: empty');
    });
});
