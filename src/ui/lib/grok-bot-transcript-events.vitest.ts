import type { ConversationMessage } from '@spiracha/lib/conversation-data/types';
import { describe, expect, it } from 'vitest';
import { grokBotMessagesToThreadEvents } from './grok-bot-transcript-events';

const message = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
    createdAtMs: 1_700_000_000_000,
    id: 'message-id',
    metadata: {},
    order: 0,
    phase: 'final_answer',
    role: 'assistant',
    text: 'message',
    toolEvidence: null,
    ...overrides,
});

describe('Grok Bot transcript events', () => {
    it('should preserve user and agent attribution while mapping transcript phases', () => {
        const events = grokBotMessagesToThreadEvents([
            message({
                id: 'user',
                phase: 'unknown',
                role: 'user',
                text: 'Question',
            }),
            message({
                id: 'agent',
                metadata: { authorName: 'Kiwi', entryKind: 'send-message' },
                text: 'Answer',
            }),
            message({
                id: 'reasoning',
                phase: 'reasoning',
                text: 'Thinking note',
            }),
        ]);

        expect(events.map((event) => event.kind)).toEqual(['message', 'message', 'reasoning']);
        expect(events[0]).toMatchObject({ role: 'user', text: 'Question', variant: 'user_message' });
        expect(events[1]).toMatchObject({ model: 'Kiwi', role: 'assistant', text: 'Answer', variant: 'agent_message' });
        expect(events[2]).toMatchObject({ kind: 'reasoning', summary: ['Thinking note'] });
    });

    it('should map tool evidence into shared tool-call and tool-output events', () => {
        const tool = {
            callId: 'call-1',
            command: null,
            durationMs: null,
            exitCode: null,
            inputText: '{"path":"/repo"}',
            name: 'search',
            namespace: null,
            outputText: null,
            status: 'unknown' as const,
            workdir: null,
        };
        const events = grokBotMessagesToThreadEvents([
            message({ id: 'tool-call', phase: 'tool_call', role: 'tool', text: 'search', toolEvidence: tool }),
            message({
                id: 'tool-output',
                phase: 'tool_output',
                role: 'tool',
                text: 'result',
                toolEvidence: { ...tool, outputText: 'result' },
            }),
        ]);

        expect(events).toEqual([
            expect.objectContaining({
                argumentsText: '{"path":"/repo"}',
                callId: 'call-1',
                kind: 'tool_call',
                name: 'search',
            }),
            expect.objectContaining({
                callId: 'call-1',
                kind: 'tool_output',
                outputText: 'result',
            }),
        ]);
    });
});
