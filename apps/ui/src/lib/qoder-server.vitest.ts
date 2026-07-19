import type { QoderSessionTranscript } from '@spiracha/lib/qoder-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    listQoderSessionsForGroupMock,
    listQoderWorkspaceGroupsMock,
    readQoderSessionTranscriptMock,
    renderQoderTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveQoderGlobalStateDbMock,
    resolveQoderWorkspaceStorageDirMock,
} = vi.hoisted(() => ({
    listQoderSessionsForGroupMock: vi.fn(),
    listQoderWorkspaceGroupsMock: vi.fn(),
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
    listQoderSessionsForGroup: listQoderSessionsForGroupMock,
    listQoderWorkspaceGroups: listQoderWorkspaceGroupsMock,
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

import {
    exportQoderSessionFn,
    exportQoderSessionsFn,
    getQoderSessionDetailFn,
    listQoderSessionsFn,
    listQoderWorkspacesFn,
} from './qoder-server';

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

    it('should list and load Qoder sessions through the source database', async () => {
        const transcript = buildTranscript('session-first', 'First session');
        listQoderWorkspaceGroupsMock.mockResolvedValue(['workspace']);
        listQoderSessionsForGroupMock.mockResolvedValue(['session']);
        readQoderSessionTranscriptMock.mockResolvedValue(transcript);

        await expect(listQoderWorkspacesFn({} as never)).resolves.toEqual(['workspace']);
        await expect(listQoderSessionsFn({ data: { workspaceKey: 'workspace-a' } } as never)).resolves.toEqual([
            'session',
        ]);
        await expect(getQoderSessionDetailFn({ data: { sessionId: 'session-first' } } as never)).resolves.toBe(
            transcript,
        );

        expect(listQoderSessionsForGroupMock).toHaveBeenCalledWith('workspace-a');
        expect(readQoderSessionTranscriptMock).toHaveBeenCalledWith(
            '/tmp/qoder-state.vscdb',
            '/tmp/qoder-workspaces',
            'session-first',
        );
    });

    it('should reject missing and empty Qoder session exports', async () => {
        readQoderSessionTranscriptMock.mockResolvedValueOnce(null);
        await expect(getQoderSessionDetailFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
            'Qoder session not found: missing',
        );

        readQoderSessionTranscriptMock.mockResolvedValue(buildTranscript('empty', 'Empty'));
        renderQoderTranscriptMock.mockReturnValue('');
        await expect(
            exportQoderSessionFn({
                data: {
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    sessionId: 'empty',
                    zipArchive: false,
                },
            } as never),
        ).rejects.toThrow('Qoder session has no exportable content: empty');
        await expect(
            exportQoderSessionsFn({
                data: {
                    includeCommentary: true,
                    includeMetadata: true,
                    includeTools: true,
                    outputFormat: 'md',
                    sessionIds: ['empty'],
                    zipArchive: true,
                },
            } as never),
        ).rejects.toThrow('Qoder session has no exportable content: empty');
    });
});
