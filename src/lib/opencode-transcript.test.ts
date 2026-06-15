import { describe, expect, it } from 'bun:test';
import type { OpenCodeSessionTranscript } from './opencode-exporter-types';
import { renderOpenCodeTranscript } from './opencode-transcript';

const transcript: OpenCodeSessionTranscript = {
    messages: [
        {
            createdAtMs: 1_700_000_000_000,
            messageId: 'msg_user',
            parts: [
                {
                    createdAtMs: 1_700_000_000_000,
                    messageId: 'msg_user',
                    partId: 'prt_user',
                    raw: { text: 'Review the fixture', type: 'text' },
                    role: 'user',
                    text: 'Review the fixture',
                    type: 'text',
                    updatedAtMs: 1_700_000_000_000,
                },
            ],
            raw: { role: 'user' },
            role: 'user',
            updatedAtMs: 1_700_000_000_000,
        },
        {
            createdAtMs: 1_700_000_000_100,
            messageId: 'msg_assistant',
            parts: [
                {
                    createdAtMs: 1_700_000_000_100,
                    messageId: 'msg_assistant',
                    partId: 'prt_reasoning',
                    raw: { text: 'Inspecting the generated files.', type: 'reasoning' },
                    role: 'assistant',
                    text: 'Inspecting the generated files.',
                    type: 'reasoning',
                    updatedAtMs: 1_700_000_000_100,
                },
                {
                    argumentsText: '{\n  "filePath": "/Users/test/workspace/demo/AGENTS.md"\n}',
                    callId: 'call_1',
                    createdAtMs: 1_700_000_000_200,
                    messageId: 'msg_assistant',
                    outputText: 'file contents',
                    partId: 'prt_tool',
                    raw: { tool: 'read', type: 'tool' },
                    role: 'assistant',
                    status: 'completed',
                    title: 'Read AGENTS',
                    toolName: 'read',
                    type: 'tool',
                    updatedAtMs: 1_700_000_000_200,
                },
                {
                    createdAtMs: 1_700_000_000_300,
                    messageId: 'msg_assistant',
                    partId: 'prt_text',
                    raw: { text: 'The review is complete.', type: 'text' },
                    role: 'assistant',
                    text: 'The review is complete.',
                    type: 'text',
                    updatedAtMs: 1_700_000_000_300,
                },
            ],
            raw: { role: 'assistant' },
            role: 'assistant',
            updatedAtMs: 1_700_000_000_300,
        },
    ],
    partCount: 4,
    renderablePartCount: 4,
    session: {
        agent: 'build',
        archivedAtMs: null,
        cost: 0.42,
        createdAtMs: 1_700_000_000_000,
        directory: '/Users/test/workspace/demo',
        lastUpdatedAtMs: 1_700_000_000_300,
        messageCount: 2,
        model: { id: 'gpt-5-codex', providerID: 'opencode', raw: null, variant: 'high' },
        modelLabel: 'gpt-5-codex high',
        partCount: 4,
        path: null,
        permission: null,
        projectId: 'pro_demo',
        renderablePartCount: 4,
        sessionId: 'ses_main',
        slug: 'quiet-mountain',
        summaryAdditions: null,
        summaryDeletions: null,
        summaryFiles: null,
        textPartCount: 2,
        title: 'Fixture review',
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensInput: 10,
        tokensOutput: 5,
        tokensReasoning: 2,
        toolPartCount: 1,
        totalTokens: 17,
        workspaceKey: 'project:pro_demo',
        workspaceLabel: 'demo',
        worktree: '/Users/test/workspace/demo',
    },
};

describe('renderOpenCodeTranscript', () => {
    it('should render OpenCode sessions as Markdown with metadata, reasoning, tools, and messages', () => {
        const markdown = renderOpenCodeTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(markdown).toContain('# Fixture review');
        expect(markdown).toContain('exported_from: "opencode_sqlite"');
        expect(markdown).toContain('## User');
        expect(markdown).toContain('Review the fixture');
        expect(markdown).toContain('## Reasoning');
        expect(markdown).toContain('Inspecting the generated files.');
        expect(markdown).toContain('Tool: `read`');
        expect(markdown).toContain('file contents');
        expect(markdown).toContain('## Assistant');
        expect(markdown).toContain('The review is complete.');
    });

    it('should omit metadata, commentary, and tools when disabled', () => {
        const markdown = renderOpenCodeTranscript(transcript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(markdown).not.toContain('exported_from');
        expect(markdown).not.toContain('Inspecting the generated files.');
        expect(markdown).not.toContain('Tool:');
        expect(markdown).toContain('The review is complete.');
    });

    it('should omit assistant commentary text when commentary is disabled', () => {
        const markdown = renderOpenCodeTranscript(
            {
                ...transcript,
                messages: [
                    transcript.messages[0]!,
                    {
                        ...transcript.messages[1]!,
                        parts: [
                            {
                                createdAtMs: 1_700_000_000_100,
                                messageId: 'msg_assistant',
                                partId: 'prt_commentary_text',
                                raw: { text: "I'll inspect the files first.", type: 'text' },
                                role: 'assistant',
                                text: "I'll inspect the files first.",
                                type: 'text',
                                updatedAtMs: 1_700_000_000_100,
                            },
                            transcript.messages[1]!.parts[1]!,
                            transcript.messages[1]!.parts[2]!,
                        ],
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

        expect(markdown).not.toContain("I'll inspect the files first.");
        expect(markdown).toContain('The review is complete.');
    });

    it('should render plain text output', () => {
        const text = renderOpenCodeTranscript(transcript, {
            includeCommentary: true,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'txt',
        });

        expect(text).toContain('Fixture review\n==============');
        expect(text).toContain('User\n----');
        expect(text).toContain('Assistant\n---------');
    });

    it('should strip MiniMax think tags from text parts and render them as commentary only when enabled', () => {
        const minimaxTranscript: OpenCodeSessionTranscript = {
            ...transcript,
            messages: [
                transcript.messages[0],
                {
                    ...transcript.messages[1],
                    parts: [
                        {
                            createdAtMs: 1_700_000_000_100,
                            messageId: 'msg_assistant',
                            partId: 'prt_minimax_text',
                            raw: {
                                text: '<think>\nInternal review notes.\n</think>\n\nFinal review.',
                                type: 'text',
                            },
                            role: 'assistant',
                            text: '<think>\nInternal review notes.\n</think>\n\nFinal review.',
                            type: 'text',
                            updatedAtMs: 1_700_000_000_100,
                        },
                    ],
                },
            ],
        };

        const withoutCommentary = renderOpenCodeTranscript(minimaxTranscript, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });
        const withCommentary = renderOpenCodeTranscript(minimaxTranscript, {
            includeCommentary: true,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });

        expect(withoutCommentary).toContain('Final review.');
        expect(withoutCommentary).not.toContain('<think>');
        expect(withoutCommentary).not.toContain('Internal review notes.');
        expect(withCommentary).toContain('## Reasoning');
        expect(withCommentary).toContain('Internal review notes.');
        expect(withCommentary).toContain('## Assistant');
        expect(withCommentary).toContain('Final review.');
        expect(withCommentary).not.toContain('<think>');
    });
});
