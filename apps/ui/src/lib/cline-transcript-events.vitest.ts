import type { ClineTaskTranscript } from '@spiracha/lib/cline-exporter-types';
import { describe, expect, it } from 'vitest';
import { clineTranscriptToThreadEvents, getClineThreadTranscriptStats } from './cline-transcript-events';

const transcript: ClineTaskTranscript = {
    messages: [
        {
            createdAtMs: 100,
            messageId: 'user',
            phase: 'unknown',
            raw: {},
            role: 'user',
            text: 'Fix the issue',
            tool: null,
        },
        {
            createdAtMs: 200,
            messageId: 'reasoning',
            phase: 'reasoning',
            raw: {},
            role: 'assistant',
            text: 'Inspect first',
            tool: null,
        },
        {
            createdAtMs: 300,
            messageId: 'call',
            phase: 'tool_call',
            raw: {},
            role: 'assistant',
            text: 'bun test',
            tool: {
                callId: 'call-1',
                command: 'bun test',
                inputText: 'bun test',
                name: 'execute_command',
                outputText: null,
                raw: {},
                status: 'succeeded',
                workdir: '/repo',
            },
        },
        {
            createdAtMs: 400,
            messageId: 'output',
            phase: 'tool_output',
            raw: {},
            role: 'tool',
            text: '1 pass',
            tool: {
                callId: 'call-1',
                command: null,
                inputText: null,
                name: 'execute_command',
                outputText: '1 pass',
                raw: {},
                status: 'succeeded',
                workdir: '/repo',
            },
        },
        {
            createdAtMs: 500,
            messageId: 'final',
            phase: 'final_answer',
            raw: {},
            role: 'assistant',
            text: 'Done',
            tool: null,
        },
    ],
    renderablePartCount: 5,
    task: {
        assistantMessageCount: 1,
        cacheReads: null,
        cacheWrites: null,
        createdAtMs: 100,
        isFavorited: false,
        lastActiveAtMs: 500,
        messageCount: 2,
        modelId: 'cline-model',
        reasoningCount: 1,
        renderablePartCount: 5,
        taskDir: '/cline/tasks/1',
        taskId: '1',
        title: 'Task',
        tokensIn: null,
        tokensOut: null,
        toolCallCount: 1,
        toolResultCount: 1,
        totalCost: null,
        uiMessagesPath: '/cline/tasks/1/ui_messages.json',
        ulid: null,
        userMessageCount: 1,
        workspaceKey: 'workspace:%2Frepo',
        workspaceLabel: 'repo',
        worktree: '/repo',
    },
};

describe('Cline transcript events', () => {
    it('should map every visible Cline phase to the shared transcript model', () => {
        const events = clineTranscriptToThreadEvents(transcript);
        expect(events.map((event) => event.kind)).toEqual([
            'message',
            'reasoning',
            'tool_call',
            'tool_output',
            'message',
        ]);
        expect(events[2]).toMatchObject({ callId: 'call-1', command: 'bun test', workdir: '/repo' });
        expect(events[3]).toMatchObject({ callId: 'call-1', exitCode: 0, outputText: '1 pass' });
        expect(events[4]).toMatchObject({ phase: 'final_answer', text: 'Done' });

        expect(getClineThreadTranscriptStats(events)).toMatchObject({
            finalAnswerCount: 1,
            toolCallCount: 1,
            toolOutputCount: 1,
        });
    });
});
