import { describe, expect, it } from 'bun:test';
import type { KiroSessionTranscript } from './kiro-exporter-types';
import { renderKiroTranscript } from './kiro-transcript';

const transcript: KiroSessionTranscript = {
    entries: [
        {
            entryId: 'u1',
            entryType: 'message',
            executionId: null,
            parts: [
                {
                    raw: { text: 'Review Descope-Class Vendor-Detection' },
                    text: 'Review Descope-Class Vendor-Detection',
                    type: 'text',
                },
                {
                    imageUrl: 'data:image/png;base64,AAA',
                    raw: { type: 'imageUrl' },
                    text: 'Image attachment',
                    type: 'image',
                },
            ],
            promptLogCount: 0,
            raw: { message: { role: 'user' } },
            role: 'user',
            timestamp: null,
        },
        {
            entryId: 'a1',
            entryType: 'message',
            executionId: 'execution-a',
            parts: [
                {
                    raw: { content: 'Vendor detection is present.' },
                    text: 'Vendor detection is present.',
                    type: 'text',
                },
            ],
            promptLogCount: 1,
            raw: { message: { role: 'assistant' } },
            role: 'assistant',
            timestamp: null,
        },
    ],
    executionEntries: [],
    historyEntries: [],
    rawExecutions: [],
    rawHistory: [],
    rawSession: { sessionId: 'session-a' },
    renderablePartCount: 3,
    session: {
        assistantMessageCount: 1,
        autonomyMode: 'Autopilot',
        createdAtIso: '2026-06-14T10:00:00.000Z',
        createdAtMs: 1_781_434_800_000,
        defaultModelTitle: 'Agent',
        filePath:
            '/Users/example/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions/ws/session-a.json',
        imageCount: 1,
        lastActiveAtIso: '2026-06-14T10:00:03.000Z',
        lastActiveAtMs: 1_781_434_803_000,
        messageCount: 2,
        promptLogCount: 1,
        renderablePartCount: 3,
        selectedModel: 'claude-sonnet-4.5',
        selectedProfileId: 'local',
        sessionId: 'session-a',
        sessionType: 'spec',
        title: 'Review Descope-Class Vendor-Detection',
        userMessageCount: 1,
        workspaceDirectory: '/Users/example/workspace/ushman-corpus',
        workspaceKey: 'workspace:encoded',
        workspaceLabel: 'ushman-corpus',
        workspacePath: '/Users/example/workspace/ushman-corpus',
        worktree: '/Users/example/workspace/ushman-corpus',
    },
};

describe('renderKiroTranscript', () => {
    it('should render metadata, messages, and image attachments as markdown', () => {
        const rendered = renderKiroTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(rendered).toContain('# Review Descope-Class Vendor-Detection');
        expect(rendered).toContain('exported_from: "kiro_workspace_sessions"');
        expect(rendered).toContain('## User');
        expect(rendered).toContain('Review Descope-Class Vendor-Detection');
        expect(rendered).toContain('## Attachment');
        expect(rendered).toContain('Image attachment');
        expect(rendered).toContain('## Assistant');
        expect(rendered).toContain('Vendor detection is present.');
    });

    it('should omit optional metadata while preserving user attachments', () => {
        const rendered = renderKiroTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(rendered).not.toContain('exported_from');
        expect(rendered).toContain('Image attachment');
        expect(rendered).toContain('Vendor detection is present.');
    });

    it('should omit assistant commentary attachments while preserving user attachments', () => {
        const rendered = renderKiroTranscript(
            {
                ...transcript,
                entries: [
                    transcript.entries[0]!,
                    {
                        entryId: 'a-commentary',
                        entryType: 'message',
                        executionId: 'execution-a',
                        parts: [
                            {
                                imageUrl: 'data:image/png;base64,BBB',
                                raw: { type: 'imageUrl' },
                                text: 'Assistant progress image',
                                type: 'image',
                            },
                        ],
                        promptLogCount: 0,
                        raw: { message: { role: 'assistant' } },
                        role: 'assistant',
                        timestamp: null,
                    },
                    transcript.entries[1]!,
                ],
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(rendered).toContain('Image attachment');
        expect(rendered).not.toContain('Assistant progress image');
        expect(rendered).toContain('Vendor detection is present.');
    });

    it('should render true plain text when requested', () => {
        const rendered = renderKiroTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'txt',
        });

        expect(rendered).toContain('Review Descope-Class Vendor-Detection\n');
        expect(rendered).toContain('=====================================');
        expect(rendered).toContain('Attachment\n----------');
        expect(rendered).not.toContain('```');
    });

    it('should respect commentary and tool export options', () => {
        const rendered = renderKiroTranscript(
            {
                ...transcript,
                entries: [
                    transcript.entries[0]!,
                    {
                        entryId: 'execution-a:read-file',
                        entryType: 'tool_call',
                        executionId: 'execution-a',
                        parts: [
                            {
                                raw: { toolName: 'read_file', type: 'toolCall' },
                                text: 'Read file: /workspace/src/hint-payload.ts:1800-2901',
                                type: 'text',
                            },
                        ],
                        promptLogCount: 0,
                        raw: { actionId: 'read-file' },
                        role: 'tool',
                        timestamp: null,
                    },
                    {
                        entryId: 'execution-a:assistant-1',
                        entryType: 'message',
                        executionId: 'execution-a',
                        parts: [
                            {
                                raw: { type: 'assistantMessage' },
                                text: "I'll conduct a comprehensive code review",
                                type: 'text',
                            },
                        ],
                        promptLogCount: 0,
                        raw: { actionId: 'assistant-1' },
                        role: 'assistant',
                        timestamp: null,
                    },
                    transcript.entries[1]!,
                ],
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(rendered).not.toContain('Read file:');
        expect(rendered).not.toContain("I'll conduct a comprehensive code review");
        expect(rendered).toContain('Vendor detection is present.');

        const verboseRendered = renderKiroTranscript(
            {
                ...transcript,
                entries: [
                    transcript.entries[0]!,
                    {
                        entryId: 'execution-a:read-file',
                        entryType: 'tool_call',
                        executionId: 'execution-a',
                        parts: [
                            {
                                raw: { toolName: 'read_file', type: 'toolCall' },
                                text: 'Read file: /workspace/src/hint-payload.ts:1800-2901',
                                type: 'text',
                            },
                        ],
                        promptLogCount: 0,
                        raw: { actionId: 'read-file' },
                        role: 'tool',
                        timestamp: null,
                    },
                    {
                        entryId: 'execution-a:assistant-1',
                        entryType: 'message',
                        executionId: 'execution-a',
                        parts: [
                            {
                                raw: { type: 'assistantMessage' },
                                text: "I'll conduct a comprehensive code review",
                                type: 'text',
                            },
                        ],
                        promptLogCount: 0,
                        raw: { actionId: 'assistant-1' },
                        role: 'assistant',
                        timestamp: null,
                    },
                    transcript.entries[1]!,
                ],
            },
            {
                includeCommentary: true,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'md',
            },
        );

        expect(verboseRendered).toContain('## Tool call');
        expect(verboseRendered).toContain('Read file: /workspace/src/hint-payload.ts:1800-2901');
        expect(verboseRendered).toContain("I'll conduct a comprehensive code review");
    });

    it('should keep the final answer for each Kiro user turn when commentary is disabled', () => {
        const rendered = renderKiroTranscript(
            {
                ...transcript,
                entries: [
                    {
                        ...transcript.entries[0]!,
                        entryId: 'u1',
                        parts: [{ raw: { text: 'First task' }, text: 'First task', type: 'text' }],
                    },
                    {
                        entryId: 'a1-commentary',
                        entryType: 'message',
                        executionId: 'execution-a',
                        parts: [{ raw: { type: 'assistantMessage' }, text: 'Reading files', type: 'text' }],
                        promptLogCount: 0,
                        raw: { actionId: 'a1-commentary' },
                        role: 'assistant',
                        timestamp: null,
                    },
                    {
                        entryId: 'a1-final',
                        entryType: 'message',
                        executionId: 'execution-a',
                        parts: [{ raw: { type: 'assistantMessage' }, text: 'First task complete', type: 'text' }],
                        promptLogCount: 0,
                        raw: { actionId: 'a1-final' },
                        role: 'assistant',
                        timestamp: null,
                    },
                    {
                        ...transcript.entries[0]!,
                        entryId: 'u2',
                        parts: [{ raw: { text: 'Second task' }, text: 'Second task', type: 'text' }],
                    },
                    {
                        entryId: 'a2-commentary',
                        entryType: 'message',
                        executionId: 'execution-b',
                        parts: [{ raw: { type: 'assistantMessage' }, text: 'Checking context', type: 'text' }],
                        promptLogCount: 0,
                        raw: { actionId: 'a2-commentary' },
                        role: 'assistant',
                        timestamp: null,
                    },
                    {
                        entryId: 'a2-final',
                        entryType: 'message',
                        executionId: 'execution-b',
                        parts: [{ raw: { type: 'assistantMessage' }, text: 'Second task complete', type: 'text' }],
                        promptLogCount: 0,
                        raw: { actionId: 'a2-final' },
                        role: 'assistant',
                        timestamp: null,
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

        expect(rendered).not.toContain('Reading files');
        expect(rendered).not.toContain('Checking context');
        expect(rendered).toContain('First task complete');
        expect(rendered).toContain('Second task complete');
    });
});
