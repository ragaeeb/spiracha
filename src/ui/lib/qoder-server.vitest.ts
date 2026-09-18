import type { QoderSessionTranscript } from '@spiracha/lib/qoder-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteQoderConversationMock,
    listQoderSessionsForGroupMock,
    listQoderWorkspaceGroupsMock,
    readQoderSessionTranscriptMock,
    renderQoderTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveQoderCliProjectsDirMock,
    resolveQoderGlobalStateDbMock,
    resolveQoderWorkspaceStorageDirMock,
} = vi.hoisted(() => ({
    deleteQoderConversationMock: vi.fn(),
    listQoderSessionsForGroupMock: vi.fn(),
    listQoderWorkspaceGroupsMock: vi.fn(),
    readQoderSessionTranscriptMock: vi.fn(),
    renderQoderTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveQoderCliProjectsDirMock: vi.fn(),
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

vi.mock('@spiracha/lib/qoder-sessions', () => ({
    listQoderSessionsForGroup: listQoderSessionsForGroupMock,
    listQoderWorkspaceGroups: listQoderWorkspaceGroupsMock,
}));

vi.mock('@spiracha/lib/qoder-session-transcript', () => ({
    readQoderSessionTranscript: readQoderSessionTranscriptMock,
}));

vi.mock('@spiracha/lib/qoder-exporter-types', async () => ({
    resolveQoderCliProjectsDir: resolveQoderCliProjectsDirMock,
    resolveQoderGlobalStateDb: resolveQoderGlobalStateDbMock,
    resolveQoderWorkspaceStorageDir: resolveQoderWorkspaceStorageDirMock,
}));

vi.mock('@spiracha/lib/qoder-mutations', () => ({
    deleteQoderConversation: deleteQoderConversationMock,
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
    deleteQoderSessionFn,
    deleteQoderSessionsFn,
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
        resolveQoderCliProjectsDirMock.mockReturnValue('/tmp/qoder-cli');
        resolveQoderGlobalStateDbMock.mockReturnValue('/tmp/qoder-state.vscdb');
        resolveQoderWorkspaceStorageDirMock.mockReturnValue('/tmp/qoder-workspaces');
        deleteQoderConversationMock.mockImplementation(async (sessionId: string) => ({
            deletedFiles: [],
            deletedIds: [sessionId],
        }));
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

    it('should delete single and batch sessions from the resolved Qoder store', async () => {
        await deleteQoderSessionFn({ data: { sessionId: 'first' } } as never);
        await deleteQoderSessionsFn({ data: { sessionIds: ['first', 'second'] } } as never);

        expect(deleteQoderConversationMock).toHaveBeenCalledWith('first', {
            cliProjectsDir: '/tmp/qoder-cli',
            globalStateDb: '/tmp/qoder-state.vscdb',
            workspaceStorageDir: '/tmp/qoder-workspaces',
        });
        expect(deleteQoderConversationMock).toHaveBeenCalledWith('second', {
            cliProjectsDir: '/tmp/qoder-cli',
            globalStateDb: '/tmp/qoder-state.vscdb',
            workspaceStorageDir: '/tmp/qoder-workspaces',
        });
    });

    it('should preserve cleanup-pending receipts for batch Qoder deletes', async () => {
        deleteQoderConversationMock
            .mockResolvedValueOnce({ deletedFiles: ['/tmp/a.json'], deletedIds: ['first'] })
            .mockResolvedValueOnce({
                cleanupFailures: [{ error: 'unlink failed', path: '/tmp/b.json', phase: 'file-cleanup' }],
                deletedFiles: [],
                deletedIds: ['second'],
                receiptId: 'receipt-second',
            });
        const result = await deleteQoderSessionsFn({ data: { sessionIds: ['first', 'second'] } } as never);
        expect(result.summary).toMatchObject({ cleanupPending: 1, deleted: 1 });
        expect(result.results.find((item) => item.id === 'second')).toMatchObject({
            deleted: true,
            receiptId: 'receipt-second',
        });
        deleteQoderConversationMock.mockResolvedValueOnce({
            cleanupFailures: [{ error: 'unlink failed', path: '/tmp/b.json', phase: 'file-cleanup' }],
            deletedFiles: [],
            deletedIds: ['only'],
            receiptId: 'receipt-only',
        });
        await expect(deleteQoderSessionFn({ data: { sessionId: 'only' } } as never)).resolves.toMatchObject({
            deletedIds: ['only'],
            receiptId: 'receipt-only',
        });
    });
});
