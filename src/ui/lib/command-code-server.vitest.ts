import type {
    CommandCodeSessionSummary,
    CommandCodeSessionTranscript,
} from '@spiracha/lib/command-code-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    listSessionsMock,
    listWorkspacesMock,
    deleteSessionMock,
    readTranscriptMock,
    renderBatchDownloadMock,
    renderCommandCodeTranscriptMock,
    renderSingleDownloadMock,
    resolveProjectsDirMock,
} = vi.hoisted(() => ({
    deleteSessionMock: vi.fn(),
    listSessionsMock: vi.fn(),
    listWorkspacesMock: vi.fn(),
    readTranscriptMock: vi.fn(),
    renderBatchDownloadMock: vi.fn(),
    renderCommandCodeTranscriptMock: vi.fn(),
    renderSingleDownloadMock: vi.fn(),
    resolveProjectsDirMock: vi.fn(),
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

vi.mock('@spiracha/lib/command-code-db', () => ({
    deleteCommandCodeSession: deleteSessionMock,
    listCommandCodeSessionSummariesForWorkspace: listSessionsMock,
    listCommandCodeWorkspaceGroups: listWorkspacesMock,
    readCommandCodeSessionTranscript: readTranscriptMock,
    resolveCommandCodeProjectsDir: resolveProjectsDirMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

vi.mock('@spiracha/lib/command-code-transcript', () => ({
    renderCommandCodeTranscript: renderCommandCodeTranscriptMock,
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSingleDownloadMock,
    renderSourceSessionsDownload: renderBatchDownloadMock,
}));

import {
    deleteCommandCodeSessionFn,
    deleteCommandCodeSessionsFn,
    exportCommandCodeSessionFn,
    exportCommandCodeSessionsFn,
    getCommandCodeSessionDetailFn,
    listCommandCodeSessionsFn,
    listCommandCodeWorkspacesFn,
} from './command-code-server';

const summary: CommandCodeSessionSummary = {
    assistantMessageCount: 1,
    createdAtMs: 1_700_000_000_000,
    cwd: '/workspace/project',
    filePath: '/tmp/session.jsonl',
    lastActiveAtMs: 1_700_000_000_100,
    messageCount: 2,
    model: 'z-ai/glm-5.3-flash',
    modelLabel: 'GLM 5.3 Flash',
    recordCount: 3,
    renderableMessageCount: 2,
    sessionId: 'session-1',
    title: 'Session one',
    toolCallCount: 0,
    toolOutputCount: 0,
    userMessageCount: 1,
    workspaceKey: 'command-code:workspace',
    workspaceLabel: 'project',
    worktree: '/workspace/project',
};

const transcript: CommandCodeSessionTranscript = {
    messages: [
        {
            createdAtMs: 1_700_000_000_000,
            id: 'message-1',
            metadata: {},
            order: 0,
            phase: 'unknown',
            role: 'user',
            text: 'Review this',
            toolEvidence: null,
        },
    ],
    rawRecords: [{ id: 'session-1', type: 'session' }],
    session: summary,
};

describe('Command Code server functions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveProjectsDirMock.mockReturnValue('/tmp/command-code/projects');
        listWorkspacesMock.mockResolvedValue([{ key: summary.workspaceKey }]);
        listSessionsMock.mockResolvedValue([summary]);
        deleteSessionMock.mockImplementation(async (_projectsDir: string, sessionId: string) => ({
            deletedFiles: [`/tmp/${sessionId}.jsonl`],
            deletedSessionIds: [sessionId],
        }));
        readTranscriptMock.mockResolvedValue(transcript);
        renderCommandCodeTranscriptMock.mockReturnValue('rendered command code transcript');
        renderSingleDownloadMock.mockResolvedValue({ mode: 'download' });
        renderBatchDownloadMock.mockResolvedValue({ mode: 'download_url' });
    });

    it('should list workspaces and sessions from the configured projects directory', async () => {
        await expect(listCommandCodeWorkspacesFn({} as never)).resolves.toEqual([{ key: summary.workspaceKey }]);
        await expect(
            listCommandCodeSessionsFn({ data: { workspaceKey: summary.workspaceKey } } as never),
        ).resolves.toEqual([summary]);

        expect(listSessionsMock).toHaveBeenCalledWith('/tmp/command-code/projects', summary.workspaceKey);
    });

    it('should render single and batch exports with the shared download UX contract', async () => {
        const options = {
            includeCommentary: false,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md' as const,
            zipArchive: false,
        };

        await expect(
            exportCommandCodeSessionFn({ data: { ...options, sessionId: summary.sessionId } } as never),
        ).resolves.toEqual({ mode: 'download' });
        await expect(
            exportCommandCodeSessionsFn({
                data: { ...options, sessionIds: [summary.sessionId, 'session-2'], zipArchive: true },
            } as never),
        ).resolves.toEqual({ mode: 'download_url' });

        expect(renderCommandCodeTranscriptMock).toHaveBeenCalledTimes(3);
        expect(renderCommandCodeTranscriptMock).toHaveBeenCalledWith(transcript, {
            includeCommentary: false,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });
        expect(renderSingleDownloadMock).toHaveBeenCalledWith({
            content: 'rendered command code transcript',
            cwd: summary.worktree,
            fallbackBaseName: 'command-code-session',
            outputFormat: 'md',
            platform: 'command-code',
            sessionId: summary.sessionId,
            updatedAtMs: summary.lastActiveAtMs,
            zipArchive: false,
        });
        expect(renderBatchDownloadMock).toHaveBeenCalledWith({
            entries: [
                {
                    content: 'rendered command code transcript',
                    cwd: summary.worktree,
                    fallbackBaseName: 'command-code-session',
                    fileBaseName: summary.title,
                    sessionId: summary.sessionId,
                    updatedAtMs: summary.lastActiveAtMs,
                },
                {
                    content: 'rendered command code transcript',
                    cwd: summary.worktree,
                    fallbackBaseName: 'command-code-session',
                    fileBaseName: summary.title,
                    sessionId: summary.sessionId,
                    updatedAtMs: summary.lastActiveAtMs,
                },
            ],
            fallbackBaseName: 'command-code-sessions',
            outputFormat: 'md',
            platform: 'command-code',
            zipArchive: true,
        });
    });

    it('should delete single and batch sessions through the source-specific database primitive', async () => {
        await expect(deleteCommandCodeSessionFn({ data: { sessionId: summary.sessionId } } as never)).resolves.toEqual({
            deletedFiles: [`/tmp/${summary.sessionId}.jsonl`],
            deletedSessionIds: [summary.sessionId],
        });
        await expect(
            deleteCommandCodeSessionsFn({ data: { sessionIds: [summary.sessionId, 'session-2'] } } as never),
        ).resolves.toEqual({
            deletedFiles: [`/tmp/${summary.sessionId}.jsonl`, '/tmp/session-2.jsonl'],
            deletedSessionIds: [summary.sessionId, 'session-2'],
        });

        expect(deleteSessionMock).toHaveBeenNthCalledWith(1, '/tmp/command-code/projects', summary.sessionId);
        expect(deleteSessionMock).toHaveBeenNthCalledWith(2, '/tmp/command-code/projects', summary.sessionId);
        expect(deleteSessionMock).toHaveBeenNthCalledWith(3, '/tmp/command-code/projects', 'session-2');
    });

    it('should serialize a transcript detail and reject missing sessions', async () => {
        await expect(
            getCommandCodeSessionDetailFn({ data: { sessionId: summary.sessionId } } as never),
        ).resolves.toEqual(transcript);
        expect(readTranscriptMock).toHaveBeenCalledWith('/tmp/command-code/projects', summary.sessionId);

        readTranscriptMock.mockResolvedValueOnce(null);
        await expect(getCommandCodeSessionDetailFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
            'Command Code session not found: missing',
        );
    });
});
