import { describe, expect, it } from 'bun:test';
import { normalizeCodexEvents } from './codex-messages';
import type { ThreadEvent } from './conversation-events';

describe('normalizeCodexEvents', () => {
    it('should treat visible assistant messages without a phase as final answers', () => {
        const events: ThreadEvent[] = [
            {
                isHiddenByDefault: false,
                kind: 'message',
                memoryCitation: null,
                model: 'gpt-5.4',
                phase: null,
                raw: {},
                role: 'assistant',
                sequence: 1,
                text: 'done',
                timestamp: null,
                variant: 'message',
            },
        ];

        expect(normalizeCodexEvents(events)[0]).toMatchObject({
            phase: 'final_answer',
            role: 'assistant',
            text: 'done',
        });
    });

    it('should keep unrecognized assistant phases as unknown', () => {
        const events: ThreadEvent[] = [
            {
                isHiddenByDefault: false,
                kind: 'message',
                memoryCitation: null,
                model: 'gpt-5.4',
                phase: 'legacy_progress',
                raw: {},
                role: 'assistant',
                sequence: 1,
                text: 'Legacy assistant update.',
                timestamp: null,
                variant: 'message',
            },
        ];

        expect(normalizeCodexEvents(events)[0]?.phase).toBe('unknown');
    });

    it('should copy the matching tool-call name onto later tool outputs', () => {
        const events: ThreadEvent[] = [
            {
                argumentsParseFailed: false,
                argumentsText: '{}',
                callId: 'call-1',
                command: null,
                kind: 'tool_call',
                name: 'search_repo',
                raw: {},
                sequence: 1,
                timestamp: null,
                workdir: null,
            },
            {
                callId: 'call-1',
                exitCode: 0,
                kind: 'tool_output',
                outputText: 'ok',
                raw: {},
                sequence: 2,
                summary: 'ok',
                timestamp: null,
                wallTime: null,
            },
        ];

        expect(normalizeCodexEvents(events).map((message) => message.toolEvidence?.name)).toEqual([
            'search_repo',
            'search_repo',
        ]);
    });
});
