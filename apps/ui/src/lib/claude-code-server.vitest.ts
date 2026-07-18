import type { ClaudeCodeSessionTranscript } from '@spiracha/lib/claude-code-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    deleteClaudeCodeSessionMock,
    readClaudeCodeSessionTranscriptMock,
    renderClaudeCodeTranscriptMock,
    renderSourceSessionDownloadMock,
    renderSourceSessionsDownloadMock,
    resolveClaudeCodeProjectsDirMock,
} = vi.hoisted(() => ({
    deleteClaudeCodeSessionMock: vi.fn(),
    readClaudeCodeSessionTranscriptMock: vi.fn(),
    renderClaudeCodeTranscriptMock: vi.fn(),
    renderSourceSessionDownloadMock: vi.fn(),
    renderSourceSessionsDownloadMock: vi.fn(),
    resolveClaudeCodeProjectsDirMock: vi.fn(),
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

vi.mock('@spiracha/lib/claude-code-db', () => ({
    deleteClaudeCodeSession: deleteClaudeCodeSessionMock,
    listClaudeCodeSessionsForGroup: vi.fn(),
    listClaudeCodeWorkspaceGroups: vi.fn(),
    readClaudeCodeSessionTranscript: readClaudeCodeSessionTranscriptMock,
    resolveClaudeCodeProjectsDir: resolveClaudeCodeProjectsDirMock,
}));

vi.mock('@spiracha/lib/claude-code-transcript', () => ({
    renderClaudeCodeTranscript: renderClaudeCodeTranscriptMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

vi.mock('./source-session-export-server', () => ({
    renderSourceSessionDownload: renderSourceSessionDownloadMock,
    renderSourceSessionsDownload: renderSourceSessionsDownloadMock,
}));

import {
    buildClaudeCodeSessionDetailPreview,
    deleteClaudeCodeSessionFn,
    deleteClaudeCodeSessionsFn,
    exportClaudeCodeSessionFn,
    exportClaudeCodeSessionsFn,
    loadClaudeCodeSessionDetail,
    loadClaudeCodeSessionFullDetail,
} from './claude-code-server';

const buildTranscript = (entryCount: number, filePath = '/tmp/session-large.jsonl'): ClaudeCodeSessionTranscript => ({
    entries: Array.from({ length: entryCount }, (_, index) => ({
        cwd: '/workspace/project',
        entryId: `entry-${index}`,
        parts: [{ raw: {}, text: `message ${index}`, type: 'text' }],
        raw: {},
        role: index % 2 === 0 ? 'user' : 'assistant',
        timestamp: `2026-06-01T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
        type: index % 2 === 0 ? 'user' : 'assistant',
    })),
    rawEvents: [],
    rawPayloadsOmitted: true,
    renderablePartCount: entryCount,
    session: {
        assistantMessageCount: Math.floor(entryCount / 2),
        attachmentCount: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        createdAtIso: '2026-06-01T10:00:00.000Z',
        createdAtMs: 1,
        cwd: '/workspace/project',
        filePath,
        gitBranch: null,
        inputTokens: 0,
        lastActiveAtIso: '2026-06-01T11:00:00.000Z',
        lastActiveAtMs: 2,
        messageCount: entryCount,
        model: 'claude-opus-4-8',
        outputTokens: 0,
        renderablePartCount: entryCount,
        sessionId: 'session-large',
        title: 'Large compacted session',
        toolCallCount: 0,
        toolResultCount: 0,
        totalTokens: 0,
        userMessageCount: Math.ceil(entryCount / 2),
        version: '2.1.205',
        workspaceKey: 'project:-workspace-project',
        workspaceLabel: 'project',
        worktree: '/workspace/project',
    },
});

describe('Claude Code server transcript loading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveClaudeCodeProjectsDirMock.mockReturnValue('/tmp/projects');
        renderClaudeCodeTranscriptMock.mockReturnValue('rendered transcript');
        renderSourceSessionDownloadMock.mockResolvedValue({ mode: 'download' });
        renderSourceSessionsDownloadMock.mockResolvedValue({ mode: 'download_url' });
    });

    it('should bound the initial detail payload while preserving the beginning and end', () => {
        const transcript = buildTranscript(1_000);

        const preview = buildClaudeCodeSessionDetailPreview(transcript);

        expect(preview.isPartial).toBe(true);
        expect(preview.omittedEntryCount).toBe(600);
        expect(preview.entries).toHaveLength(400);
        expect(preview.entries[0]?.entryId).toBe('entry-0');
        expect(preview.entries.at(-1)?.entryId).toBe('entry-999');
    });

    it('should return a bounded preview for the SSR detail request and full entries only on explicit load', async () => {
        const transcript = buildTranscript(1_000);
        readClaudeCodeSessionTranscriptMock.mockResolvedValue(transcript);

        const preview = await loadClaudeCodeSessionDetail('session-large');
        const full = await loadClaudeCodeSessionFullDetail('session-large');

        expect(preview).toMatchObject({ isPartial: true, omittedEntryCount: 600 });
        expect(preview.entries).toHaveLength(400);
        expect(full.entries).toHaveLength(1_000);
        expect(readClaudeCodeSessionTranscriptMock).toHaveBeenNthCalledWith(1, '/tmp/projects', 'session-large', {
            maxRawPayloadFileSizeBytes: 8 * 1024 * 1024,
        });
        expect(readClaudeCodeSessionTranscriptMock).toHaveBeenNthCalledWith(2, '/tmp/projects', 'session-large', {
            includeRawPayloads: false,
        });
    });

    it('should load a small detail transcript once while retaining raw payloads', async () => {
        const transcript = buildTranscript(10, import.meta.filename);
        transcript.rawEvents = [{ type: 'user' }];
        transcript.rawPayloadsOmitted = undefined;
        readClaudeCodeSessionTranscriptMock.mockResolvedValue(transcript);

        const detail = await loadClaudeCodeSessionDetail('session-small');

        expect(detail.rawEvents).toEqual([{ type: 'user' }]);
        expect(readClaudeCodeSessionTranscriptMock).toHaveBeenCalledTimes(1);
        expect(readClaudeCodeSessionTranscriptMock).toHaveBeenCalledWith('/tmp/projects', 'session-small', {
            maxRawPayloadFileSizeBytes: 8 * 1024 * 1024,
        });
    });

    it('should aggregate bulk Claude delete results', async () => {
        deleteClaudeCodeSessionMock
            .mockResolvedValueOnce({ deletedFiles: ['/tmp/root.jsonl'], deletedSessionIds: ['root', 'child'] })
            .mockResolvedValueOnce({ deletedFiles: [], deletedSessionIds: [] });

        const result = await deleteClaudeCodeSessionsFn({ data: { sessionIds: ['root', 'child'] } } as never);

        expect(result).toEqual({
            deletedFiles: ['/tmp/root.jsonl'],
            deletedSessionIds: ['root', 'child'],
        });
    });

    it('should reject a missing Claude Code session delete', async () => {
        deleteClaudeCodeSessionMock.mockResolvedValue({ deletedFiles: [], deletedSessionIds: [] });

        await expect(deleteClaudeCodeSessionFn({ data: { sessionId: 'missing' } } as never)).rejects.toThrow(
            'Claude Code session not found: missing',
        );
    });

    it('should forward every export option for single and batch Claude Code sessions', async () => {
        const first = buildTranscript(1);
        const second = buildTranscript(1);
        second.session = { ...second.session, sessionId: 'session-second', title: 'Second session' };
        readClaudeCodeSessionTranscriptMock
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
        await exportClaudeCodeSessionFn({ data: { ...options, sessionId: first.session.sessionId } } as never);
        await exportClaudeCodeSessionsFn({
            data: { ...options, sessionIds: [first.session.sessionId, second.session.sessionId] },
        } as never);

        expect(readClaudeCodeSessionTranscriptMock).toHaveBeenCalledTimes(3);
        for (const sessionId of [first.session.sessionId, first.session.sessionId, second.session.sessionId]) {
            expect(readClaudeCodeSessionTranscriptMock).toHaveBeenCalledWith('/tmp/projects', sessionId, {
                includeRawPayloads: false,
            });
        }
        expect(renderClaudeCodeTranscriptMock).toHaveBeenCalledTimes(3);
        for (const transcript of [first, first, second]) {
            expect(renderClaudeCodeTranscriptMock).toHaveBeenCalledWith(transcript, {
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
});
