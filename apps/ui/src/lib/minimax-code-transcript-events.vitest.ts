import type { MiniMaxCodeSessionTranscript } from '@spiracha/lib/minimax-code-exporter-types';
import { describe, expect, it } from 'vitest';
import {
    getMiniMaxCodeThreadTranscriptStats,
    miniMaxCodeTranscriptToThreadEvents,
} from './minimax-code-transcript-events';

const transcript: MiniMaxCodeSessionTranscript = {
    messages: [
        {
            content: 'Plan this refactor.',
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
            content: 'I am investigating.',
            createdAtMs: 1_700_000_001_000,
            finishReason: 'toolUse',
            messageId: 'assistant-progress',
            messageType: 2,
            raw: {},
            reasoning: 'I need the complete picture.',
            role: 'assistant',
            thinkingDurationMs: 100,
            toolCalls: [
                {
                    argumentsText: '{"command":"grep -rn evidence-extraction CHANGELOG.md"}',
                    callId: 'call-1',
                    command: 'grep -rn evidence-extraction CHANGELOG.md',
                    outputText: 'CHANGELOG.md:42',
                    raw: {},
                    status: 'succeeded',
                    toolName: 'bash',
                },
            ],
        },
        {
            content: 'The plan is ready.',
            createdAtMs: 1_700_000_002_000,
            finishReason: 'stop',
            messageId: 'assistant-final',
            messageType: 1,
            raw: {},
            reasoning: null,
            role: 'assistant',
            thinkingDurationMs: null,
            toolCalls: [],
        },
    ],
    renderablePartCount: 6,
    session: {
        agentName: 'main',
        appMode: 'coding',
        archived: false,
        assistantMessageCount: 2,
        createdAtMs: 1_700_000_000_000,
        currentModelId: 'minimax/MiniMax-M3',
        currentModelVariant: 'thinking',
        lastActiveAtMs: 1_700_000_002_000,
        messageCount: 3,
        reasoningCount: 1,
        renderablePartCount: 6,
        runtime: 'pi-agent',
        sessionDir: '/tmp/session',
        sessionId: 'mvs_session',
        sessionType: 'branch',
        snapshotPath: '/tmp/session/snapshot.json',
        status: 'finished',
        title: 'Refactor',
        toolCallCount: 1,
        toolResultCount: 1,
        userMessageCount: 1,
        workspaceKey: 'workspace:%2Frepo',
        workspaceLabel: 'repo',
        worktree: '/repo',
    },
};

describe('MiniMax Code transcript events', () => {
    it('should convert visible text, reasoning, and paired tools into ordered thread events', () => {
        const events = miniMaxCodeTranscriptToThreadEvents(transcript);

        expect(events.map((event) => event.kind)).toEqual([
            'message',
            'reasoning',
            'message',
            'tool_call',
            'tool_output',
            'message',
        ]);
        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'reasoning',
                    summary: ['I need the complete picture.'],
                }),
                expect.objectContaining({
                    command: 'grep -rn evidence-extraction CHANGELOG.md',
                    kind: 'tool_call',
                    name: 'bash',
                }),
                expect.objectContaining({
                    kind: 'tool_output',
                    outputText: 'CHANGELOG.md:42',
                }),
                expect.objectContaining({
                    kind: 'message',
                    phase: 'final_answer',
                    text: 'The plan is ready.',
                }),
            ]),
        );
        expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
        expect(getMiniMaxCodeThreadTranscriptStats(events)).toMatchObject({
            assistantMessageCount: 2,
            finalAnswerCount: 1,
            toolCallCount: 1,
            toolOutputCount: 1,
            userMessageCount: 1,
        });
    });
});
