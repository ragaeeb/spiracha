import { describe, expect, it } from 'bun:test';
import type { GrokTranscriptEntry } from './grok-exporter-types';
import { getFinalGrokAssistantTextPartIds, getGrokTextPartPhase } from './grok-transcript-phase';

describe('grok transcript phase helpers', () => {
    it('should mark tool-leading Grok assistant text as commentary and the terminal answer as final', () => {
        const entries: GrokTranscriptEntry[] = [
            {
                createdAtMs: null,
                entryId: 'assistant-1',
                parts: [
                    { partId: 'assistant-1:text', raw: {}, text: 'Starting work.', type: 'text' },
                    { partId: 'assistant-1:tool-call:0', raw: {}, toolName: 'Read', type: 'tool_call' },
                ],
                raw: {},
                role: 'assistant',
                timestamp: null,
                type: 'assistant',
            },
            {
                createdAtMs: null,
                entryId: 'assistant-2',
                parts: [{ partId: 'assistant-2:text', raw: {}, text: 'Implemented the change.', type: 'text' }],
                raw: {},
                role: 'assistant',
                timestamp: null,
                type: 'assistant',
            },
        ];

        const finalPartIds = getFinalGrokAssistantTextPartIds(entries);

        expect([...finalPartIds]).toEqual(['assistant-2:text']);
        expect(getGrokTextPartPhase(entries[0]!, entries[0]!.parts[0]!, finalPartIds)).toBe('commentary');
        expect(getGrokTextPartPhase(entries[1]!, entries[1]!.parts[0]!, finalPartIds)).toBe('final_answer');
    });

    it('should not assign an assistant phase to user text', () => {
        const entry: GrokTranscriptEntry = {
            createdAtMs: null,
            entryId: 'user-1',
            parts: [{ partId: 'user-1:text', raw: {}, text: 'Please continue.', type: 'text' }],
            raw: {},
            role: 'user',
            timestamp: null,
            type: 'user',
        };

        expect(getGrokTextPartPhase(entry, entry.parts[0]!, new Set())).toBeNull();
    });
});
