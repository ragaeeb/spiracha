import type { ClaudeCodeSessionTranscript } from '@spiracha/lib/claude-code-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readClaudeCodeSessionTranscriptMock, resolveClaudeCodeProjectsDirMock } = vi.hoisted(() => ({
    readClaudeCodeSessionTranscriptMock: vi.fn(),
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
    deleteClaudeCodeSession: vi.fn(),
    listClaudeCodeSessionsForGroup: vi.fn(),
    listClaudeCodeWorkspaceGroups: vi.fn(),
    readClaudeCodeSessionTranscript: readClaudeCodeSessionTranscriptMock,
    resolveClaudeCodeProjectsDir: resolveClaudeCodeProjectsDirMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

import {
    buildClaudeCodeSessionDetailPreview,
    loadClaudeCodeSessionDetail,
    loadClaudeCodeSessionFullDetail,
} from './claude-code-server';

const buildTranscript = (entryCount: number): ClaudeCodeSessionTranscript => ({
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
        filePath: '/tmp/session-large.jsonl',
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
            includeRawPayloads: false,
        });
        expect(readClaudeCodeSessionTranscriptMock).toHaveBeenNthCalledWith(2, '/tmp/projects', 'session-large', {
            includeRawPayloads: false,
        });
    });
});
