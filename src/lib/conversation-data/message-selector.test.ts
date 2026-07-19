import { describe, expect, it } from 'bun:test';
import { selectConversationMessages } from './message-selector';
import type { ConversationMessage } from './types';

const baseMessage = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
    createdAtMs: null,
    id: 'message',
    metadata: {},
    order: 0,
    phase: 'unknown',
    role: 'unknown',
    text: 'text',
    ...overrides,
});

describe('conversation message selection', () => {
    it('should return all messages when requested', () => {
        const messages = [
            baseMessage({ id: 'user-1', role: 'user', text: 'request' }),
            baseMessage({ id: 'assistant-1', role: 'assistant', text: 'answer' }),
        ];

        expect(selectConversationMessages(messages, 'all')).toEqual(messages);
    });

    it('should select the last assistant final answer for review collection', () => {
        const messages = [
            baseMessage({ id: 'assistant-1', order: 1, phase: 'commentary', role: 'assistant', text: 'working' }),
            baseMessage({ id: 'assistant-2', order: 2, phase: 'final_answer', role: 'assistant', text: 'final' }),
            baseMessage({ id: 'tool-1', order: 3, role: 'tool', text: 'output' }),
        ];

        expect(selectConversationMessages(messages, 'last_final_answer')).toEqual([messages[1]]);
    });

    it('should select the last assistant message regardless of phase', () => {
        const messages = [
            baseMessage({ id: 'assistant-1', order: 1, phase: 'final_answer', role: 'assistant', text: 'final' }),
            baseMessage({ id: 'tool-1', order: 2, role: 'tool', text: 'output' }),
            baseMessage({ id: 'assistant-2', order: 3, phase: 'commentary', role: 'assistant', text: 'latest' }),
        ];

        expect(selectConversationMessages(messages, 'last_assistant')).toEqual([messages[2]]);
    });

    it('should not treat commentary as a final answer when no final answer exists', () => {
        const messages = [
            baseMessage({ id: 'assistant-1', order: 1, phase: 'commentary', role: 'assistant', text: 'first' }),
            baseMessage({ id: 'assistant-2', order: 2, phase: 'commentary', role: 'assistant', text: 'second' }),
        ];

        expect(selectConversationMessages(messages, 'last_final_answer')).toEqual([]);
    });

    it('should not expose reasoning as a final-answer fallback', () => {
        const messages = [
            baseMessage({ id: 'assistant-1', order: 1, phase: 'commentary', role: 'assistant', text: 'Status.' }),
            baseMessage({ id: 'assistant-2', order: 2, phase: 'reasoning', role: 'assistant', text: 'Private chain.' }),
        ];

        expect(selectConversationMessages(messages, 'last_final_answer')).toEqual([]);
        expect(selectConversationMessages([messages[1]!], 'last_final_answer')).toEqual([]);
    });
});
