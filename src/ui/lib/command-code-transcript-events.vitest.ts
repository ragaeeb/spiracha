import type { ConversationMessage } from '@spiracha/lib/conversation-data/types';
import { describe, expect, it } from 'vitest';
import {
    commandCodeMessagesToThreadEvents,
    getCommandCodeThreadTranscriptStats,
} from './command-code-transcript-events';

const message = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
    createdAtMs: 1_700_000_000_000,
    id: 'message-id',
    metadata: {},
    order: 0,
    phase: 'unknown',
    role: 'assistant',
    text: 'message',
    toolEvidence: null,
    ...overrides,
});

describe('Command Code transcript events', () => {
    it('should map reasoning, tools, and messages into transcript events', () => {
        const events = commandCodeMessagesToThreadEvents([
            message({ id: 'reasoning', phase: 'reasoning', text: 'Thinking' }),
            message({
                id: 'tool-call',
                phase: 'tool_call',
                text: 'Read a file',
                toolEvidence: {
                    callId: 'call-1',
                    command: 'read_file',
                    durationMs: null,
                    exitCode: null,
                    inputText: '{"path":"AGENTS.md"}',
                    name: 'read_file',
                    namespace: null,
                    outputText: null,
                    status: 'unknown',
                    workdir: '/workspace',
                },
            }),
            message({
                id: 'tool-output',
                phase: 'tool_output',
                role: 'tool',
                text: 'contents',
                toolEvidence: {
                    callId: 'call-1',
                    command: null,
                    durationMs: null,
                    exitCode: 0,
                    inputText: null,
                    name: 'read_file',
                    namespace: null,
                    outputText: 'contents',
                    status: 'succeeded',
                    workdir: null,
                },
            }),
            message({ id: 'user', phase: 'unknown', role: 'user', text: 'Review this' }),
            message({ id: 'answer', model: 'glm-5.3-flash', phase: 'final_answer', text: 'Done' }),
        ]);

        expect(events.map((event) => event.kind)).toEqual([
            'reasoning',
            'tool_call',
            'tool_output',
            'message',
            'message',
        ]);
        expect(events[1]).toMatchObject({
            argumentsText: '{"path":"AGENTS.md"}',
            callId: 'call-1',
            command: 'read_file',
            kind: 'tool_call',
            workdir: '/workspace',
        });
        expect(events[2]).toMatchObject({ callId: 'call-1', exitCode: 0, kind: 'tool_output', outputText: 'contents' });
        expect(events[3]).toMatchObject({ kind: 'message', phase: null, role: 'user' });
        expect(events[4]).toMatchObject({ kind: 'message', model: 'glm-5.3-flash', phase: 'final_answer' });
        expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4]);
        expect(getCommandCodeThreadTranscriptStats(events)).toMatchObject({
            assistantMessageCount: 1,
            finalAnswerCount: 1,
            messageCount: 2,
            toolCallCount: 1,
            toolOutputCount: 1,
            userMessageCount: 1,
        });
    });
});
