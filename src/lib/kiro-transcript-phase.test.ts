import { describe, expect, it } from 'bun:test';
import type { KiroTranscriptEntry } from './kiro-exporter-types';
import { getFinalKiroAssistantMessageEntryIds, getKiroMessagePhase } from './kiro-transcript-phase';

const entry = (
    entryId: string,
    role: string,
    entryType: KiroTranscriptEntry['entryType'] = 'message',
): KiroTranscriptEntry => ({
    entryId,
    entryType,
    executionId: entryType === 'tool_call' ? 'execution-a' : null,
    parts: [{ raw: { text: entryId }, text: entryId, type: 'text' }],
    promptLogCount: 0,
    raw: {},
    role,
    timestamp: null,
});

describe('kiro transcript phase helpers', () => {
    it('should classify the last assistant message before each user turn as final answer', () => {
        const entries = [
            entry('u1', 'user'),
            entry('a1-commentary', 'assistant'),
            entry('a1-final', 'assistant'),
            entry('u2', 'user'),
            entry('a2-commentary', 'assistant'),
            entry('a2-final', 'assistant'),
        ];
        const finalIds = getFinalKiroAssistantMessageEntryIds(entries);

        expect([...finalIds].sort()).toEqual(['a1-final', 'a2-final']);
        expect(getKiroMessagePhase(entries[1]!, finalIds)).toBe('commentary');
        expect(getKiroMessagePhase(entries[2]!, finalIds)).toBe('final_answer');
        expect(getKiroMessagePhase(entries[4]!, finalIds)).toBe('commentary');
        expect(getKiroMessagePhase(entries[5]!, finalIds)).toBe('final_answer');
    });

    it('should ignore tool-call entries when computing final assistant messages', () => {
        const entries = [
            entry('u1', 'user'),
            entry('a1', 'assistant'),
            entry('tool1', 'tool', 'tool_call'),
            entry('a2', 'assistant'),
        ];

        expect([...getFinalKiroAssistantMessageEntryIds(entries)]).toEqual(['a2']);
    });
});
