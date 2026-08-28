import type { FxSessionTranscript } from '@spiracha/lib/fx-exporter-types';
import { describe, expect, it } from 'vitest';
import { fxTranscriptToThreadEvents, getFxThreadTranscriptStats } from './fx-transcript-events';

const transcript: FxSessionTranscript = {
    messages: [
        {
            content: 'Implement and complete migration',
            createdAtMs: 1_700_000_000_000,
            finishReason: null,
            messageId: 'user-1',
            messageType: 1,
            raw: {},
            reasoning: null,
            role: 'user',
            thinkingDurationMs: null,
            toolCalls: [],
        },
        {
            content: 'I am inspecting the migration.',
            createdAtMs: 1_700_000_001_000,
            finishReason: 'toolUse',
            messageId: 'assistant-progress',
            messageType: 2,
            raw: {},
            reasoning: null,
            role: 'assistant',
            thinkingDurationMs: null,
            toolCalls: [
                {
                    argumentsText: '{"command":"git status --short"}',
                    callId: 'call-1',
                    command: 'git status --short',
                    outputText: ' M migration.ts',
                    raw: {},
                    status: 'succeeded',
                    toolName: 'shell',
                },
            ],
        },
        {
            content: 'Migration complete.',
            createdAtMs: 1_700_000_002_000,
            finishReason: 'stop',
            messageId: 'assistant-final',
            messageType: 2,
            raw: {},
            reasoning: null,
            role: 'assistant',
            thinkingDurationMs: null,
            toolCalls: [],
        },
    ],
    renderablePartCount: 5,
    session: {
        assistantMessageCount: 2,
        conversationLanguage: 'en',
        createdAtMs: 1_700_000_000_000,
        currentModelId: 'anthropic/claude-opus-4.1',
        currentModelVariant: 'high',
        lastActiveAtMs: 1_700_000_002_000,
        messageCount: 3,
        reasoningCount: 0,
        renderablePartCount: 5,
        sessionDir: '/tmp/.fx/sessions/session-1',
        sessionId: 'session-1',
        status: 'complete',
        title: 'Migration',
        toolCallCount: 1,
        toolResultCount: 1,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        userMessageCount: 1,
        workspaceKey: 'workspace:%2Frepo',
        workspaceLabel: 'repo',
        worktree: '/repo',
    },
};

describe('FX transcript events', () => {
    it('should preserve user prompts, commentary, tool evidence, and final answers in order', () => {
        const events = fxTranscriptToThreadEvents(transcript);

        expect(events.map((event) => event.kind)).toEqual([
            'message',
            'message',
            'tool_call',
            'tool_output',
            'message',
        ]);
        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'message',
                    phase: 'commentary',
                    text: 'I am inspecting the migration.',
                }),
                expect.objectContaining({ command: 'git status --short', kind: 'tool_call', name: 'shell' }),
                expect.objectContaining({ kind: 'tool_output', outputText: 'M migration.ts' }),
                expect.objectContaining({ kind: 'message', phase: 'final_answer', text: 'Migration complete.' }),
            ]),
        );
        expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
        expect(getFxThreadTranscriptStats(events)).toMatchObject({
            assistantMessageCount: 2,
            finalAnswerCount: 1,
            toolCallCount: 1,
            toolOutputCount: 1,
            userMessageCount: 1,
        });
    });
});
