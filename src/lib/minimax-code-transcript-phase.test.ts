import { describe, expect, it } from 'bun:test';
import type { MiniMaxCodeTranscriptMessage } from './minimax-code-exporter-types';
import { getMiniMaxCodeMessagePhase } from './minimax-code-transcript-phase';

const message = (overrides: Partial<MiniMaxCodeTranscriptMessage>): MiniMaxCodeTranscriptMessage => ({
    content: null,
    createdAtMs: 1,
    finishReason: null,
    messageId: 'message-1',
    messageType: 2,
    raw: {},
    reasoning: null,
    role: 'assistant',
    thinkingDurationMs: null,
    toolCalls: [],
    ...overrides,
});

describe('MiniMax Code transcript phases', () => {
    it('should not assign assistant phases to user messages', () => {
        expect(getMiniMaxCodeMessagePhase(message({ finishReason: null, role: 'user' }))).toBeNull();
    });
});
