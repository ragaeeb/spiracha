import { describe, expect, it } from 'bun:test';
import type { ClaudeCodeSessionTranscript } from './claude-code-exporter-types';
import { renderClaudeCodeTranscript } from './claude-code-transcript';

const transcript: ClaudeCodeSessionTranscript = {
    entries: [
        {
            cwd: '/Users/example/workspace/ushman-corpus',
            entryId: 'u1',
            parts: [
                {
                    raw: { text: 'Review Descope-Class Vendor-Detection' },
                    text: 'Review Descope-Class Vendor-Detection',
                    type: 'text',
                },
            ],
            raw: { type: 'user' },
            role: 'user',
            timestamp: '2026-06-01T10:00:00.000Z',
            type: 'user',
        },
        {
            cwd: '/Users/example/workspace/ushman-corpus',
            entryId: 'a1',
            model: 'claude-sonnet-4-5',
            parts: [
                {
                    raw: { thinking: 'Need inspect first.' },
                    text: 'Need inspect first.',
                    type: 'thinking',
                },
                {
                    argumentsText: '{\n  "command": "rg vendor"\n}',
                    raw: { name: 'Bash' },
                    toolName: 'Bash',
                    toolUseId: 'toolu_1',
                    type: 'tool_use',
                },
                {
                    raw: { text: 'Vendor detection is present.' },
                    text: 'Vendor detection is present.',
                    type: 'text',
                },
            ],
            raw: { type: 'assistant' },
            role: 'assistant',
            timestamp: '2026-06-01T10:00:04.000Z',
            type: 'assistant',
        },
        {
            cwd: '/Users/example/workspace/ushman-corpus',
            entryId: 'u2',
            parts: [
                {
                    isError: false,
                    outputText: 'src/vendor.ts: match',
                    raw: { tool_use_id: 'toolu_1' },
                    toolUseId: 'toolu_1',
                    type: 'tool_result',
                },
            ],
            raw: { type: 'user' },
            role: 'user',
            timestamp: '2026-06-01T10:00:05.000Z',
            type: 'user',
        },
    ],
    rawEvents: [],
    renderablePartCount: 5,
    session: {
        assistantMessageCount: 1,
        attachmentCount: 0,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 3,
        createdAtIso: '2026-06-01T10:00:00.000Z',
        createdAtMs: 1_780_307_200_000,
        cwd: '/Users/example/workspace/ushman-corpus',
        filePath: '/Users/example/.claude/projects/-Users-example-workspace-ushman-corpus/session-a.jsonl',
        gitBranch: 'main',
        inputTokens: 10,
        lastActiveAtIso: '2026-06-01T10:00:05.000Z',
        lastActiveAtMs: 1_780_307_205_000,
        messageCount: 3,
        model: 'claude-sonnet-4-5',
        outputTokens: 4,
        renderablePartCount: 5,
        sessionId: 'session-a',
        title: 'Review Descope-Class Vendor-Detection',
        toolCallCount: 1,
        toolResultCount: 1,
        totalTokens: 19,
        userMessageCount: 2,
        version: '2.1.148',
        workspaceKey: 'project:-Users-example-workspace-ushman-corpus',
        workspaceLabel: 'ushman-corpus',
        worktree: '/Users/example/workspace/ushman-corpus',
    },
};

describe('renderClaudeCodeTranscript', () => {
    it('should render metadata, reasoning, tool calls, tool outputs, and messages as markdown', () => {
        const rendered = renderClaudeCodeTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(rendered).toContain('# Review Descope-Class Vendor-Detection');
        expect(rendered).toContain('exported_from: "claude_code_local_jsonl"');
        expect(rendered).toContain('## User');
        expect(rendered).toContain('Review Descope-Class Vendor-Detection');
        expect(rendered).toContain('## Reasoning');
        expect(rendered).toContain('Need inspect first.');
        expect(rendered).toContain('## Tool Call');
        expect(rendered).toContain('Tool: `Bash`');
        expect(rendered).toContain('"command": "rg vendor"');
        expect(rendered).toContain('## Tool Output');
        expect(rendered).toContain('src/vendor.ts: match');
        expect(rendered).toContain('Vendor detection is present.');
    });

    it('should omit optional metadata, commentary, and tools', () => {
        const rendered = renderClaudeCodeTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(rendered).not.toContain('exported_from');
        expect(rendered).not.toContain('Need inspect first.');
        expect(rendered).not.toContain('Tool:');
        expect(rendered).toContain('Vendor detection is present.');
    });

    it('should render true plain text when requested', () => {
        const rendered = renderClaudeCodeTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'txt',
        });

        expect(rendered).toContain('Review Descope-Class Vendor-Detection\n');
        expect(rendered).toContain('=====================================');
        expect(rendered).toContain('Tool: Bash');
        expect(rendered).not.toContain('```');
    });

    it('should omit assistant tool-use lead-ins when commentary is disabled', () => {
        const rendered = renderClaudeCodeTranscript(
            {
                ...transcript,
                entries: [
                    transcript.entries[0]!,
                    {
                        cwd: '/Users/example/workspace/ushman-corpus',
                        entryId: 'a1',
                        model: 'claude-opus-4-8',
                        parts: [
                            {
                                raw: { text: "I'll start by reading the roadmap" },
                                text: "I'll start by reading the roadmap",
                                type: 'text',
                            },
                            {
                                argumentsText: '{\n  "file_path": "MILESTONE-ROADMAP.md"\n}',
                                raw: { name: 'Read' },
                                toolName: 'Read',
                                toolUseId: 'toolu_roadmap',
                                type: 'tool_use',
                            },
                        ],
                        raw: { message: { stop_reason: 'tool_use' }, type: 'assistant' },
                        role: 'assistant',
                        timestamp: '2026-06-01T10:00:01.000Z',
                        type: 'assistant',
                    },
                    {
                        cwd: '/Users/example/workspace/ushman-corpus',
                        entryId: 'a2',
                        model: 'claude-opus-4-8',
                        parts: [
                            {
                                raw: { text: 'All four proposals are written...' },
                                text: 'All four proposals are written...',
                                type: 'text',
                            },
                        ],
                        raw: { message: { stop_reason: 'end_turn' }, type: 'assistant' },
                        role: 'assistant',
                        timestamp: '2026-06-01T10:00:02.000Z',
                        type: 'assistant',
                    },
                ],
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(rendered).not.toContain("I'll start by reading the roadmap");
        expect(rendered).not.toContain('Tool:');
        expect(rendered).toContain('All four proposals are written...');
    });

    it('should omit Claude compaction control entries from exports', () => {
        const rendered = renderClaudeCodeTranscript(
            {
                ...transcript,
                entries: [
                    {
                        cwd: '/Users/example/workspace/ushman-corpus',
                        entryId: 'compact-summary',
                        parts: [
                            {
                                raw: { text: 'This session is being continued from a previous conversation.' },
                                text: 'This session is being continued from a previous conversation.',
                                type: 'text',
                            },
                        ],
                        raw: { isCompactSummary: true, type: 'user' },
                        role: 'user',
                        timestamp: '2026-06-01T09:59:00.000Z',
                        type: 'user',
                    },
                    {
                        cwd: '/Users/example/workspace/ushman-corpus',
                        entryId: 'compact-command',
                        parts: [
                            {
                                raw: { text: '<command-name>/compact</command-name>' },
                                text: '<command-name>/compact</command-name>',
                                type: 'text',
                            },
                        ],
                        raw: { type: 'user' },
                        role: 'user',
                        timestamp: '2026-06-01T09:59:01.000Z',
                        type: 'user',
                    },
                    ...transcript.entries,
                ],
            },
            {
                includeCommentary: true,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(rendered).not.toContain('This session is being continued');
        expect(rendered).not.toContain('<command-name>/compact</command-name>');
        expect(rendered).toContain('Review Descope-Class Vendor-Detection');
    });
});
