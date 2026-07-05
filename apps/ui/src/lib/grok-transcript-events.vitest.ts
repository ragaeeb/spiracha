import type { GrokSessionTranscript } from '@spiracha/lib/grok-exporter-types';
import { describe, expect, it } from 'vitest';
import { grokTranscriptToThreadEvents } from './grok-transcript-events';

const transcript: GrokSessionTranscript = {
    entries: [
        {
            createdAtMs: null,
            entryId: 'user-1',
            parts: [
                {
                    partId: 'user-1:text',
                    raw: { content: 'Review this.' },
                    text: 'Review this.',
                    type: 'text',
                },
            ],
            raw: { content: 'Review this.', type: 'user' },
            role: 'user',
            timestamp: null,
            type: 'user',
        },
        {
            createdAtMs: null,
            entryId: 'reasoning-1',
            parts: [
                {
                    partId: 'reasoning-1:reasoning',
                    raw: { summary: [{ summary_text: 'Thinking.' }] },
                    text: 'Thinking.',
                    type: 'reasoning',
                },
            ],
            raw: { summary: [{ summary_text: 'Thinking.' }], type: 'reasoning' },
            role: 'assistant',
            timestamp: null,
            type: 'reasoning',
        },
        {
            createdAtMs: null,
            entryId: 'assistant-1',
            modelId: 'grok-composer-2.5-fast',
            parts: [
                {
                    argumentsText: '{"pattern":"refresh"}',
                    partId: 'assistant-1:tool-call:0',
                    raw: { arguments: '{"pattern":"refresh"}', name: 'Grep' },
                    toolCallId: 'call-1',
                    toolName: 'Grep',
                    type: 'tool_call',
                },
            ],
            raw: { content: '', type: 'assistant' },
            role: 'assistant',
            timestamp: null,
            type: 'assistant',
        },
        {
            createdAtMs: null,
            entryId: 'tool-1',
            parts: [
                {
                    outputText: 'found 1 match',
                    partId: 'tool-1:tool-result',
                    raw: { content: 'found 1 match', tool_call_id: 'call-1' },
                    toolCallId: 'call-1',
                    type: 'tool_result',
                },
            ],
            raw: { content: 'found 1 match', tool_call_id: 'call-1', type: 'tool_result' },
            role: 'tool',
            timestamp: null,
            type: 'tool_result',
        },
        {
            createdAtMs: null,
            entryId: 'assistant-2',
            modelId: 'grok-composer-2.5-fast',
            parts: [
                {
                    partId: 'assistant-2:text',
                    raw: { content: 'Final answer.' },
                    text: 'Final answer.',
                    type: 'text',
                },
            ],
            raw: { content: 'Final answer.', type: 'assistant' },
            role: 'assistant',
            timestamp: null,
            type: 'assistant',
        },
    ],
    rawEvents: [],
    renderablePartCount: 5,
    session: {
        agentName: 'cursor',
        assistantMessageCount: 1,
        chatHistoryPath: '/tmp/chat_history.jsonl',
        chatMessageCount: 5,
        createdAtIso: null,
        createdAtMs: null,
        currentModelId: 'grok-composer-2.5-fast',
        cwd: '/repo',
        gitBranch: null,
        gitRemotes: [],
        gitRootDir: null,
        headCommit: null,
        lastActiveAtIso: null,
        lastActiveAtMs: null,
        messageCount: 5,
        modelLabel: 'Composer 2.5',
        reasoningCount: 1,
        renderablePartCount: 5,
        sandboxProfile: null,
        sessionDir: '/tmp/session',
        sessionId: 'session-1',
        summaryPath: '/tmp/summary.json',
        title: 'Review',
        toolCallCount: 1,
        toolResultCount: 1,
        updatesPath: null,
        userMessageCount: 1,
        workspaceKey: 'workspace:%2Frepo',
        workspaceLabel: 'repo',
        worktree: '/repo',
    },
};

describe('grok transcript events', () => {
    it('should convert Grok transcript parts into thread events', () => {
        const events = grokTranscriptToThreadEvents(transcript);

        expect(events).toEqual([
            expect.objectContaining({ kind: 'message', role: 'user', text: 'Review this.' }),
            expect.objectContaining({ content: 'Thinking.', kind: 'reasoning' }),
            expect.objectContaining({ command: 'Grep\n{"pattern":"refresh"}', kind: 'tool_call' }),
            expect.objectContaining({ kind: 'tool_output', outputText: 'found 1 match' }),
            expect.objectContaining({
                kind: 'message',
                model: 'grok-composer-2.5-fast',
                phase: 'final_answer',
                role: 'assistant',
                text: 'Final answer.',
            }),
        ]);
    });
});
