import { describe, expect, it } from 'bun:test';
import type { ClaudeCodeTranscriptEntry } from './claude-code-exporter-types';
import {
    getClaudeCodeAssistantMessagePhase,
    isClaudeCodeSyntheticTranscriptEntry,
} from './claude-code-transcript-phase';

const buildEntry = (role: string, stopReason: string | null): ClaudeCodeTranscriptEntry => ({
    cwd: null,
    entryId: `${role}:${stopReason ?? 'none'}`,
    parts: [],
    raw: {
        message: stopReason === null ? {} : { stop_reason: stopReason },
    },
    role,
    timestamp: null,
    type: role,
});

describe('claude code transcript phase helpers', () => {
    it('should classify assistant tool-use stop messages as commentary', () => {
        expect(getClaudeCodeAssistantMessagePhase(buildEntry('assistant', 'tool_use'))).toBe('commentary');
    });

    it('should classify assistant end-turn messages as final answers', () => {
        expect(getClaudeCodeAssistantMessagePhase(buildEntry('assistant', 'end_turn'))).toBe('final_answer');
    });

    it('should default assistant messages without a stop reason to final answers', () => {
        expect(getClaudeCodeAssistantMessagePhase(buildEntry('assistant', null))).toBe('final_answer');
    });

    it('should use a normalized assistant phase when raw payloads were omitted', () => {
        expect(
            getClaudeCodeAssistantMessagePhase({
                ...buildEntry('assistant', null),
                assistantPhase: 'commentary',
                raw: {},
            }),
        ).toBe('commentary');
    });

    it('should leave user messages unphased', () => {
        expect(getClaudeCodeAssistantMessagePhase(buildEntry('user', null))).toBeNull();
    });

    it('should classify compaction summaries and local command envelopes as synthetic', () => {
        const buildUserEntry = (text: string, raw: ClaudeCodeTranscriptEntry['raw'] = {}) => ({
            ...buildEntry('user', null),
            parts: [{ raw: { text }, text, type: 'text' as const }],
            raw,
        });

        expect(isClaudeCodeSyntheticTranscriptEntry(buildUserEntry('summary', { isCompactSummary: true }))).toBe(true);
        expect(
            isClaudeCodeSyntheticTranscriptEntry(
                buildUserEntry('<command-name>/compact</command-name>\n<command-message>compact</command-message>'),
            ),
        ).toBe(true);
        expect(
            isClaudeCodeSyntheticTranscriptEntry(
                buildUserEntry('<local-command-caveat>Caveat</local-command-caveat>', { isMeta: true }),
            ),
        ).toBe(true);
        expect(isClaudeCodeSyntheticTranscriptEntry(buildUserEntry('Actual user message'))).toBe(false);
        expect(
            isClaudeCodeSyntheticTranscriptEntry(
                buildUserEntry('<command-name>/code-review</command-name>\n<command-args>Review this</command-args>'),
            ),
        ).toBe(false);
    });

    it('should classify Claude API error messages as synthetic', () => {
        expect(
            isClaudeCodeSyntheticTranscriptEntry({
                ...buildEntry('assistant', 'stop_sequence'),
                parts: [
                    {
                        text: 'API Error: Connection closed mid-response.',
                        type: 'text',
                    },
                ],
                raw: { isApiErrorMessage: true },
            }),
        ).toBe(true);
    });

    it('should classify Claude synthetic assistant placeholders as synthetic', () => {
        expect(
            isClaudeCodeSyntheticTranscriptEntry({
                ...buildEntry('assistant', 'stop_sequence'),
                parts: [{ text: 'No response requested.', type: 'text' }],
                raw: {
                    isApiErrorMessage: false,
                    message: {
                        model: '<synthetic>',
                        stop_reason: 'stop_sequence',
                    },
                },
            }),
        ).toBe(true);
    });
});
