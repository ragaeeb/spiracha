import type {
    CommandCodeSessionSummary,
    CommandCodeSessionTranscript,
} from '@spiracha/lib/command-code-exporter-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listSessionsMock, listWorkspacesMock, readTranscriptMock, resolveProjectsDirMock } = vi.hoisted(() => ({
    listSessionsMock: vi.fn(),
    listWorkspacesMock: vi.fn(),
    readTranscriptMock: vi.fn(),
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
    listCommandCodeSessionSummariesForWorkspace: listSessionsMock,
    listCommandCodeWorkspaceGroups: listWorkspacesMock,
    readCommandCodeSessionTranscript: readTranscriptMock,
    resolveCommandCodeProjectsDir: resolveProjectsDirMock,
}));

vi.mock('@spiracha/lib/transcript-load-limiter', () => ({
    runWithTranscriptLoadLimit: (loader: () => Promise<unknown>) => loader(),
}));

import {
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
        readTranscriptMock.mockResolvedValue(transcript);
    });

    it('should list workspaces and sessions from the configured projects directory', async () => {
        await expect(listCommandCodeWorkspacesFn({} as never)).resolves.toEqual([{ key: summary.workspaceKey }]);
        await expect(
            listCommandCodeSessionsFn({ data: { workspaceKey: summary.workspaceKey } } as never),
        ).resolves.toEqual([summary]);

        expect(listSessionsMock).toHaveBeenCalledWith('/tmp/command-code/projects', summary.workspaceKey);
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
