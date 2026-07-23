import { describe, expect, it } from 'bun:test';
import type { ThreadEvent } from './codex-browser-types';
import { type CodexTranscriptEventFilters, shouldShowCodexTranscriptEvent } from './codex-transcript-filter';

const filters = (overrides: Partial<CodexTranscriptEventFilters> = {}): CodexTranscriptEventFilters => ({
    showCommentary: false,
    showExtraEvents: false,
    showToolCalls: false,
    showUserMessages: true,
    ...overrides,
});

const event = (overrides: Partial<ThreadEvent>): ThreadEvent =>
    ({
        isHiddenByDefault: false,
        kind: 'message',
        memoryCitation: null,
        model: null,
        phase: null,
        raw: {},
        role: 'assistant',
        sequence: 0,
        text: 'message',
        timestamp: null,
        variant: 'message',
        ...overrides,
    }) as ThreadEvent;

describe('Codex transcript filtering', () => {
    it('should apply message visibility controls independently', () => {
        const commentary = event({ phase: 'commentary' });
        const hidden = event({ isHiddenByDefault: true });
        const user = event({ role: 'user' });
        const hiddenUser = event({ isHiddenByDefault: true, role: 'user' });

        expect(shouldShowCodexTranscriptEvent(commentary, filters())).toBe(false);
        expect(shouldShowCodexTranscriptEvent(commentary, filters({ showCommentary: true }))).toBe(true);
        expect(shouldShowCodexTranscriptEvent(hidden, filters())).toBe(false);
        expect(shouldShowCodexTranscriptEvent(hidden, filters({ showExtraEvents: true }))).toBe(true);
        expect(shouldShowCodexTranscriptEvent(user, filters({ showUserMessages: false }))).toBe(false);
        expect(shouldShowCodexTranscriptEvent(hiddenUser, filters({ showUserMessages: true }))).toBe(false);
    });

    it('should gate tool and extra events behind their matching controls', () => {
        const toolCall = event({ kind: 'tool_call' });
        const reasoning = event({ kind: 'reasoning' });

        expect(shouldShowCodexTranscriptEvent(toolCall, filters())).toBe(false);
        expect(shouldShowCodexTranscriptEvent(toolCall, filters({ showToolCalls: true }))).toBe(true);
        expect(shouldShowCodexTranscriptEvent(reasoning, filters())).toBe(false);
        expect(shouldShowCodexTranscriptEvent(reasoning, filters({ showExtraEvents: true }))).toBe(true);
    });
});
