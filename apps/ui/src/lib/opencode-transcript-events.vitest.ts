import type { OpenCodeSessionTranscript } from '@spiracha/lib/opencode-exporter-types';
import { describe, expect, it } from 'vitest';
import { getOpenCodeThreadTranscriptStats, openCodeTranscriptToThreadEvents } from './opencode-transcript-events';

const buildTranscript = (): OpenCodeSessionTranscript => ({
    messages: [
        {
            createdAtMs: 1_700_000_000_000,
            messageId: 'msg_user',
            parts: [
                {
                    createdAtMs: 1_700_000_000_000,
                    messageId: 'msg_user',
                    partId: 'prt_user',
                    raw: { text: 'Review this', type: 'text' },
                    role: 'user',
                    text: 'Review this',
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
                    raw: { text: 'Thinking through it', type: 'reasoning' },
                    role: 'assistant',
                    text: 'Thinking through it',
                    type: 'reasoning',
                    updatedAtMs: 1_700_000_000_100,
                },
                {
                    argumentsText: '{\n  "filePath": "AGENTS.md"\n}',
                    callId: 'call_1',
                    createdAtMs: 1_700_000_000_200,
                    messageId: 'msg_assistant',
                    outputText: 'contents',
                    partId: 'prt_tool',
                    raw: { tool: 'read', type: 'tool' },
                    role: 'assistant',
                    status: 'completed',
                    toolName: 'read',
                    type: 'tool',
                    updatedAtMs: 1_700_000_000_200,
                },
                {
                    createdAtMs: 1_700_000_000_300,
                    messageId: 'msg_assistant',
                    partId: 'prt_text',
                    raw: { text: 'Done', type: 'text' },
                    role: 'assistant',
                    text: 'Done',
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
        cost: 0,
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
        title: 'Demo',
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensInput: 1,
        tokensOutput: 2,
        tokensReasoning: 3,
        toolPartCount: 1,
        totalTokens: 6,
        workspaceKey: 'project:pro_demo',
        workspaceLabel: 'demo',
        worktree: '/Users/test/workspace/demo',
    },
});

describe('openCodeTranscriptToThreadEvents', () => {
    it('should adapt OpenCode parts into transcript-view events', () => {
        const events = openCodeTranscriptToThreadEvents(buildTranscript());

        expect(events.map((event) => event.kind)).toEqual([
            'message',
            'reasoning',
            'tool_call',
            'tool_output',
            'message',
        ]);
        expect(events[0]).toMatchObject({ kind: 'message', role: 'user', text: 'Review this' });
        expect(events[4]).toMatchObject({ kind: 'message', phase: 'final_answer', role: 'assistant', text: 'Done' });
        expect(events[2]).toMatchObject({ callId: 'call_1', kind: 'tool_call', name: 'read' });
        expect(events[3]).toMatchObject({ kind: 'tool_output', outputText: 'contents' });
    });

    it('should count OpenCode transcript stats', () => {
        const transcript = buildTranscript();
        const assistantMessage = transcript.messages[1];
        if (!assistantMessage) {
            throw new Error('missing assistant message');
        }
        assistantMessage.parts[1] = {
            ...assistantMessage.parts[1]!,
            toolName: 'Bash',
        };
        const stats = getOpenCodeThreadTranscriptStats(openCodeTranscriptToThreadEvents(transcript));

        expect(stats.messageCount).toBe(2);
        expect(stats.userMessageCount).toBe(1);
        expect(stats.assistantMessageCount).toBe(1);
        expect(stats.finalAnswerCount).toBe(1);
        expect(stats.toolCallCount).toBe(1);
        expect(stats.toolOutputCount).toBe(1);
        expect(stats.execCommandCount).toBe(1);
    });

    it('should treat MiniMax think tags in text parts as reasoning instead of final answers', () => {
        const transcript = buildTranscript();
        const assistantMessage = transcript.messages[1];
        if (!assistantMessage) {
            throw new Error('missing assistant message');
        }
        assistantMessage.parts = [
            {
                createdAtMs: 1_700_000_000_100,
                messageId: 'msg_assistant',
                partId: 'prt_minimax_text',
                raw: { text: '<think>\nInternal review notes.\n</think>\n\nFinal review.', type: 'text' },
                role: 'assistant',
                text: '<think>\nInternal review notes.\n</think>\n\nFinal review.',
                type: 'text',
                updatedAtMs: 1_700_000_000_100,
            },
        ];

        const events = openCodeTranscriptToThreadEvents(transcript);

        expect(events.map((event) => event.kind)).toEqual(['message', 'reasoning', 'message']);
        expect(events[1]).toMatchObject({ content: 'Internal review notes.', kind: 'reasoning' });
        expect(events[2]).toMatchObject({
            kind: 'message',
            phase: 'final_answer',
            role: 'assistant',
            text: 'Final review.',
        });
    });

    it('should normalize think tags in reasoning parts', () => {
        const transcript = buildTranscript();
        const assistantMessage = transcript.messages[1];
        if (!assistantMessage) {
            throw new Error('missing assistant message');
        }
        assistantMessage.parts = [
            {
                createdAtMs: 1_700_000_000_100,
                messageId: 'msg_assistant',
                partId: 'prt_reasoning',
                raw: { text: '<think>\nInternal note.\n</think>\nVisible note.', type: 'reasoning' },
                role: 'assistant',
                text: '<think>\nInternal note.\n</think>\nVisible note.',
                type: 'reasoning',
                updatedAtMs: 1_700_000_000_100,
            },
        ];

        const events = openCodeTranscriptToThreadEvents(transcript);

        expect(events[1]).toMatchObject({
            content: 'Internal note.\n\nVisible note.',
            kind: 'reasoning',
        });
    });

    it('should assign unique monotonically increasing event sequences for multi-event parts', () => {
        const transcript = buildTranscript();
        const assistantMessage = transcript.messages[1];
        if (!assistantMessage) {
            throw new Error('missing assistant message');
        }
        assistantMessage.parts = [
            {
                createdAtMs: 1_700_000_000_100,
                messageId: 'msg_assistant',
                partId: 'prt_minimax_text',
                raw: { text: '<think>One</think><think>Two</think>Final', type: 'text' },
                role: 'assistant',
                text: '<think>One</think><think>Two</think>Final',
                type: 'text',
                updatedAtMs: 1_700_000_000_100,
            },
            {
                createdAtMs: 1_700_000_000_200,
                messageId: 'msg_assistant',
                partId: 'prt_next_text',
                raw: { text: 'Next', type: 'text' },
                role: 'assistant',
                text: 'Next',
                type: 'text',
                updatedAtMs: 1_700_000_000_200,
            },
        ];

        const events = openCodeTranscriptToThreadEvents(transcript);

        expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
    });
});
