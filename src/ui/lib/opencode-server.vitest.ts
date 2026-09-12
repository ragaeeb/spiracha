import type { OpenCodeSessionTranscript } from '@spiracha/lib/opencode-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteOpenCodeDesktopSessionStateWithResultMock,
    deleteOpenCodeSessionMock,
    deleteOpenCodeWorkspaceMock,
    listOpenCodeSessionsForGroupMock,
    listOpenCodeWorkspaceGroupsMock,
    readOpenCodeSessionTranscriptMock,
    renderOpenCodeTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
} = vi.hoisted(() => ({
    deleteOpenCodeDesktopSessionStateWithResultMock: vi.fn(),
    deleteOpenCodeSessionMock: vi.fn(),
    deleteOpenCodeWorkspaceMock: vi.fn(),
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
    deleteOpenCodeDesktopSessionStateWithResult: deleteOpenCodeDesktopSessionStateWithResultMock,
    deleteOpenCodeSession: deleteOpenCodeSessionMock,
    deleteOpenCodeWorkspace: deleteOpenCodeWorkspaceMock,
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
    deleteOpenCodeWorkspaceFn,
    deleteOpenCodeWorkspacesFn,
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
        deleteOpenCodeWorkspaceMock.mockImplementation(async (_dbPath: string, workspaceKey: string) => ({
            cleanupFailures: [],
            deletedProjectIds: [],
            deletedSessionIds: [],
            workspaceFound: true,
            workspaceKey,
        }));
        deleteOpenCodeDesktopSessionStateWithResultMock.mockResolvedValue({ cleanupFailures: [], removedPaths: [] });
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
        deleteOpenCodeSessionMock.mockImplementation(async (_dbPath: string, sessionId: string) => ({
            deletedSessionIds: [sessionId],
        }));

        await expect(listOpenCodeWorkspacesFn({} as never)).resolves.toEqual(['workspace']);
        await expect(listOpenCodeSessionsFn({ data: { workspaceKey: 'workspace-a' } } as never)).resolves.toEqual([
            'session',
        ]);
        await expect(getOpenCodeSessionDetailFn({ data: { sessionId: 'session-1' } } as never)).resolves.toBe(
            transcript,
        );
        await expect(deleteOpenCodeSessionFn({ data: { sessionId: 'session-1' } } as never)).resolves.toEqual({
            deletedSessionIds: ['session-1'],
        });
        await expect(
            deleteOpenCodeSessionsFn({ data: { sessionIds: ['session-1', 'session-2'] } } as never),
        ).resolves.toEqual({ deletedSessionIds: ['session-1', 'session-2'] });

        expect(listOpenCodeSessionsForGroupMock).toHaveBeenCalledWith('workspace-a');
        expect(deleteOpenCodeSessionMock).toHaveBeenCalledTimes(3);
    });

    it('should delete one OpenCode workspace without requiring sessions to exist', async () => {
        deleteOpenCodeWorkspaceMock.mockResolvedValue({
            cleanupFailures: [],
            deletedProjectIds: ['empty-project'],
            deletedSessionIds: [],
            workspaceFound: true,
            workspaceKey: 'project:empty-project',
        });

        await expect(
            deleteOpenCodeWorkspaceFn({ data: { workspaceKey: 'project:empty-project' } } as never),
        ).resolves.toEqual({
            cleanupFailures: [],
            deletedProjectIds: ['empty-project'],
            deletedSessionIds: [],
            workspaceFound: true,
            workspaceKey: 'project:empty-project',
        });
        expect(deleteOpenCodeWorkspaceMock).toHaveBeenCalledWith('/tmp/opencode.db', 'project:empty-project');
    });

    it('should return ordered per-workspace results while deduplicating batch keys', async () => {
        await expect(
            deleteOpenCodeWorkspacesFn({
                data: { workspaceKeys: ['project:first', 'project:first', 'directory:c2lib3BhY2Uvc2Vjb25k'] },
            } as never),
        ).resolves.toEqual({
            failures: [],
            results: [
                expect.objectContaining({ workspaceKey: 'project:first' }),
                expect.objectContaining({ workspaceKey: 'directory:c2lib3BhY2Uvc2Vjb25k' }),
            ],
        });
        expect(deleteOpenCodeWorkspaceMock.mock.calls.map((call) => call[1])).toEqual([
            'project:first',
            'directory:c2lib3BhY2Uvc2Vjb25k',
        ]);
    });

    it('should keep a workspace delete retryable after desktop cleanup fails', async () => {
        deleteOpenCodeWorkspaceMock.mockResolvedValueOnce({
            cleanupFailures: [{ error: 'state is busy', path: '/tmp/opencode/broken.dat', phase: 'desktop_state' }],
            cleanupRetryPlan: {
                sessionIds: ['session-1'],
                workspaceKey: 'project:workspace-a',
                worktrees: ['/workspace/a'],
            },
            deletedProjectIds: ['workspace-a'],
            deletedSessionIds: ['session-1'],
            workspaceFound: true,
            workspaceKey: 'project:workspace-a',
        });

        const firstResponse = await deleteOpenCodeWorkspaceFn({
            data: { workspaceKey: 'project:workspace-a' },
        } as never);

        expect(firstResponse).toMatchObject({
            cleanupFailures: [{ error: 'state is busy', path: '/tmp/opencode/broken.dat', phase: 'desktop_state' }],
            retryTarget: { token: expect.any(String) },
        });
        expect(firstResponse).not.toHaveProperty('cleanupRetryPlan');
        if (!firstResponse.retryTarget) {
            throw new Error('expected OpenCode cleanup retry target');
        }

        await expect(
            deleteOpenCodeWorkspaceFn({
                data: { retry: firstResponse.retryTarget, workspaceKey: 'project:workspace-a' },
            } as never),
        ).resolves.toMatchObject({ cleanupFailures: [], workspaceKey: 'project:workspace-a' });
        expect(deleteOpenCodeDesktopSessionStateWithResultMock).toHaveBeenCalledWith(['session-1'], undefined, [
            '/workspace/a',
        ]);
    });

    it('should reject a missing OpenCode workspace without reporting a successful delete', async () => {
        deleteOpenCodeWorkspaceMock.mockResolvedValue({
            cleanupFailures: [],
            deletedProjectIds: [],
            deletedSessionIds: [],
            workspaceFound: false,
            workspaceKey: 'project:missing',
        });

        await expect(deleteOpenCodeWorkspaceFn({ data: { workspaceKey: 'project:missing' } } as never)).rejects.toThrow(
            'OpenCode workspace not found: project:missing',
        );
    });

    it('should reject missing and empty OpenCode session exports', async () => {
        readOpenCodeSessionTranscriptMock.mockResolvedValueOnce(null);
        await expect(getOpenCodeSessionDetailFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
            'OpenCode session not found: missing',
        );
        deleteOpenCodeSessionMock.mockResolvedValueOnce({ deletedSessionIds: [] });
        await expect(deleteOpenCodeSessionFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
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
