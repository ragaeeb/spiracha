import { describe, expect, it } from 'bun:test';
import type { GrokSessionTranscript } from './grok-exporter-types';
import { renderGrokTranscript } from './grok-transcript';

const transcript: GrokSessionTranscript = {
    entries: [
        {
            createdAtMs: 1_700_000_000_000,
            entryId: 'user-1',
            parts: [{ partId: 'user-1:text', raw: {}, text: 'Audit the exporter.', type: 'text' }],
            raw: {},
            role: 'user',
            timestamp: '2026-07-17T12:00:00.000Z',
            type: 'user',
        },
        {
            createdAtMs: 1_700_000_001_000,
            entryId: 'assistant-progress',
            parts: [
                {
                    partId: 'assistant-progress:text',
                    raw: {},
                    text: 'Inspecting the export path.',
                    type: 'text',
                },
                {
                    argumentsText: '{"path":"src/index.ts"}',
                    partId: 'assistant-progress:tool',
                    raw: {},
                    toolCallId: 'tool-1',
                    toolName: 'read_file',
                    type: 'tool_call',
                },
            ],
            raw: {},
            role: 'assistant',
            timestamp: '2026-07-17T12:00:01.000Z',
            type: 'assistant',
        },
        {
            createdAtMs: 1_700_000_002_000,
            entryId: 'tool-1',
            parts: [
                {
                    outputText: 'export const fixed = true;',
                    partId: 'tool-1:result',
                    raw: {},
                    toolCallId: 'tool-1',
                    type: 'tool_result',
                },
            ],
            raw: {},
            role: 'tool',
            timestamp: '2026-07-17T12:00:02.000Z',
            type: 'tool',
        },
        {
            createdAtMs: 1_700_000_003_000,
            entryId: 'assistant-final',
            parts: [
                {
                    partId: 'assistant-final:text',
                    raw: {},
                    text: 'The export path is fixed.',
                    type: 'text',
                },
            ],
            raw: {},
            role: 'assistant',
            timestamp: '2026-07-17T12:00:03.000Z',
            type: 'assistant',
        },
    ],
    rawEvents: [],
    renderablePartCount: 5,
    session: {
        agentName: 'Grok',
        assistantMessageCount: 2,
        chatHistoryPath: '/tmp/grok/session-1/chat_history.jsonl',
        chatMessageCount: 4,
        createdAtIso: '2026-07-17T12:00:00.000Z',
        createdAtMs: 1_700_000_000_000,
        currentModelId: 'grok-code-fast-1',
        cwd: '/tmp/project',
        gitBranch: 'main',
        gitRemotes: [],
        gitRootDir: '/tmp/project',
        headCommit: null,
        lastActiveAtIso: '2026-07-17T12:00:03.000Z',
        lastActiveAtMs: 1_700_000_003_000,
        messageCount: 4,
        modelLabel: 'Grok Code Fast',
        reasoningCount: 0,
        renderablePartCount: 5,
        sandboxProfile: null,
        sessionDir: '/tmp/grok/session-1',
        sessionId: 'session-1',
        summaryPath: '/tmp/grok/session-1/summary.json',
        title: 'Export audit',
        toolCallCount: 1,
        toolResultCount: 1,
        updatesPath: null,
        userMessageCount: 1,
        workspaceKey: 'workspace:project',
        workspaceLabel: 'project',
        worktree: '/tmp/project',
    },
};

describe('renderGrokTranscript', () => {
    it('should render metadata, commentary, tools, and final messages when enabled', () => {
        const markdown = renderGrokTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(markdown).toContain('# Export audit');
        expect(markdown).toContain('exported_from: "grok_local_session"');
        expect(markdown).toContain('Inspecting the export path.');
        expect(markdown).toContain('Tool: `read_file`');
        expect(markdown).toContain('export const fixed = true;');
        expect(markdown).toContain('The export path is fixed.');
    });

    it('should omit progress commentary, metadata, and tools when disabled', () => {
        const markdown = renderGrokTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(markdown).toContain('Audit the exporter.');
        expect(markdown).toContain('The export path is fixed.');
        expect(markdown).not.toContain('Inspecting the export path.');
        expect(markdown).not.toContain('exported_from');
        expect(markdown).not.toContain('read_file');
        expect(markdown).not.toContain('export const fixed = true;');
    });

    it('should render true plain text output', () => {
        const text = renderGrokTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });

        expect(text).toContain('Export audit\n============');
        expect(text).toContain('Assistant\n---------\nThe export path is fixed.');
        expect(text).not.toContain('#');
        expect(text).not.toContain('`');
    });
});
