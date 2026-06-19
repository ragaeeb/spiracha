import { describe, expect, it } from 'bun:test';
import type { QoderTranscriptEntry } from './qoder-exporter-types';
import { getFinalQoderAssistantMessageEntryIds, getQoderMessagePhase } from './qoder-transcript-phase';

const entry = (
    entryId: string,
    role: string,
    entryType: QoderTranscriptEntry['entryType'] = 'message',
): QoderTranscriptEntry => ({
    entryId,
    entryType,
    parts: [],
    raw: {},
    requestId: null,
    role,
    timestamp: null,
});

describe('qoder transcript phase helpers', () => {
    it('should classify the last assistant message before each user turn as final', () => {
        const entries = [
            entry('u1', 'user'),
            entry('a1-commentary', 'assistant'),
            entry('tool-1', 'tool', 'tool_call'),
            entry('a1-final', 'assistant'),
            entry('u2', 'user'),
            entry('a2-final', 'assistant'),
        ];

        const finalIds = getFinalQoderAssistantMessageEntryIds(entries);

        expect(getQoderMessagePhase(entries[1]!, finalIds)).toBe('commentary');
        expect(getQoderMessagePhase(entries[3]!, finalIds)).toBe('final_answer');
        expect(getQoderMessagePhase(entries[5]!, finalIds)).toBe('final_answer');
        expect(getQoderMessagePhase(entries[0]!, finalIds)).toBeNull();
    });

    it('should ignore every tool entry type when choosing final assistant messages', () => {
        const entries = [
            entry('u1', 'user'),
            entry('a1-final', 'assistant'),
            entry('tool-call', 'tool', 'tool_call'),
            entry('tool-output', 'tool', 'tool_output'),
            entry('u2', 'user'),
        ];

        const finalIds = getFinalQoderAssistantMessageEntryIds(entries);

        expect(finalIds).toEqual(new Set(['a1-final']));
    });
});
