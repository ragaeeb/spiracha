import { describe, expect, it } from 'bun:test';
import type { ClaudeCodeTranscriptEntry } from './claude-code-exporter-types';
import { getClaudeCodeAssistantMessagePhase } from './claude-code-transcript-phase';

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

    it('should leave user messages unphased', () => {
        expect(getClaudeCodeAssistantMessagePhase(buildEntry('user', null))).toBeNull();
    });
});
