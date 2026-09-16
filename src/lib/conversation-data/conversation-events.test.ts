import { describe, expect, it } from 'bun:test';
import { toCanonicalMessage } from './adapter-helpers';
import {
    canonicalMessagesToThreadEvents,
    projectDisplayText,
    shouldShowTranscriptEvent,
    type ThreadEvent,
    type TranscriptEventFilters,
} from './conversation-events';

const filters = (overrides: Partial<TranscriptEventFilters> = {}): TranscriptEventFilters => ({
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

describe('conversation presentation events', () => {
    it('should apply message visibility controls independently', () => {
        const commentary = event({ phase: 'commentary' });
        const hidden = event({ isHiddenByDefault: true });
        const user = event({ role: 'user' });
        const hiddenUser = event({ isHiddenByDefault: true, role: 'user' });

        expect(shouldShowTranscriptEvent(commentary, filters())).toBe(false);
        expect(shouldShowTranscriptEvent(commentary, filters({ showCommentary: true }))).toBe(true);
        expect(shouldShowTranscriptEvent(hidden, filters())).toBe(false);
        expect(shouldShowTranscriptEvent(hidden, filters({ showExtraEvents: true }))).toBe(true);
        expect(shouldShowTranscriptEvent(user, filters({ showUserMessages: false }))).toBe(false);
        expect(shouldShowTranscriptEvent(hiddenUser, filters({ showUserMessages: true }))).toBe(false);
    });

    it('should gate tool and extra events behind their matching controls', () => {
        const toolCall = event({ kind: 'tool_call' });
        const reasoning = event({ kind: 'reasoning' });

        expect(shouldShowTranscriptEvent(toolCall, filters())).toBe(false);
        expect(shouldShowTranscriptEvent(toolCall, filters({ showToolCalls: true }))).toBe(true);
        expect(shouldShowTranscriptEvent(reasoning, filters())).toBe(false);
        expect(shouldShowTranscriptEvent(reasoning, filters({ showExtraEvents: true }))).toBe(true);
    });

    it('should truncate display text without mutating the original body', () => {
        const original = `${'A'.repeat(4000)}AFTER_4000${'B'.repeat(16_000)}AFTER_20000`;
        const preview = projectDisplayText(original, 4000);

        expect(preview.truncated).toBe(true);
        expect(preview.previewText).toBe(original.slice(0, 4000));
        expect(preview.previewText).not.toContain('AFTER_4000');
        expect(preview.originalCharacters).toBe(original.length);
        expect(original).toContain('AFTER_4000');
        expect(original).toContain('AFTER_20000');
        expect(projectDisplayText(original, original.length)).toEqual({
            originalCharacters: original.length,
            previewText: original,
            truncated: false,
        });
    });

    it('should project canonical messages into shared thread events', () => {
        const events = canonicalMessagesToThreadEvents(
            [
                toCanonicalMessage({
                    createdAtMs: 1,
                    id: 'u',
                    metadata: {},
                    order: 0,
                    phase: 'unknown',
                    role: 'user',
                    text: 'Ask',
                    toolEvidence: null,
                }),
                toCanonicalMessage({
                    createdAtMs: 2,
                    id: 'r',
                    metadata: {},
                    order: 1,
                    phase: 'reasoning',
                    role: 'assistant',
                    text: 'Think',
                    toolEvidence: null,
                }),
            ],
            { source: 'command_code' },
        );
        expect(events.map((event) => event.kind)).toEqual(['message', 'reasoning']);
        expect(events[0]).toMatchObject({ role: 'user', text: 'Ask', variant: 'user_message' });
        expect(events[1]).toMatchObject({ kind: 'reasoning', summary: ['Think'] });
        expect(events[0]?.raw).toMatchObject({ source: 'command_code' });
    });

    it('should keep generic presentation events and UI projection off Codex-owned modules', async () => {
        const [events, types, view, search, filter] = await Promise.all([
            Bun.file(new URL('./conversation-events.ts', import.meta.url)).text(),
            Bun.file(new URL('../codex-browser-types.ts', import.meta.url)).text(),
            Bun.file(new URL('../../ui/components/transcript-view.tsx', import.meta.url)).text(),
            Bun.file(new URL('../../ui/components/transcript-search.tsx', import.meta.url)).text(),
            Bun.file(new URL('../codex-transcript-filter.ts', import.meta.url)).exists(),
        ]);

        expect(events).not.toContain('codex-browser-types');
        expect(events).not.toContain('codex-transcript-filter');
        expect(types).not.toMatch(/\bexport type ThreadEvent\b/u);
        expect(types).not.toMatch(/\bexport type MessageEvent\b/u);
        expect(types).not.toMatch(/\bexport type ThreadTranscriptStats\b/u);
        expect(view).not.toContain('codex-browser-types');
        expect(view).not.toContain('codex-transcript-filter');
        expect(search).not.toContain('codex-browser-types');
        expect(filter).toBe(false);
    });
});
