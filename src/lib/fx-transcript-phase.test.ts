import { describe, expect, it } from 'bun:test';
import type { FxTranscriptMessage } from './fx-exporter-types';
import { getFxMessagePhase } from './fx-transcript-phase';

const message = (finishReason: string | null, role = 'assistant'): FxTranscriptMessage => ({
    content: 'text',
    createdAtMs: 1,
    finishReason,
    messageId: 'message',
    messageType: role === 'user' ? 1 : 2,
    raw: {},
    reasoning: null,
    role,
    thinkingDurationMs: null,
    toolCalls: [],
});

describe('FX transcript phase', () => {
    it('should classify completed assistant turns as final answers', () => {
        expect(getFxMessagePhase(message('stop'))).toBe('final_answer');
    });

    it('should classify tool and in-progress assistant messages as commentary', () => {
        expect(getFxMessagePhase(message('toolUse'))).toBe('commentary');
        expect(getFxMessagePhase(message('in_progress'))).toBe('commentary');
        expect(getFxMessagePhase(message(null, 'user'))).toBeNull();
    });
});
