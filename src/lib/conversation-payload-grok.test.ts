import { describe, expect, it } from 'bun:test';
import { parseGrokPayload } from './conversation-payload-grok';

describe('Grok payload parser', () => {
    it('should parse chat history JSONL records with reasoning, tools, and models', () => {
        const payload = {
            chat_history: [
                { content: 'System prompt', type: 'system' },
                {
                    content: [{ text: '<user_query>Review the vendor detector.</user_query>', type: 'text' }],
                    type: 'user',
                },
                { summary: [{ summary_text: 'Inspecting the protected surface.' }], type: 'reasoning' },
                {
                    content: '',
                    model_id: 'grok-composer-2.5-fast',
                    tool_calls: [{ arguments: { command: 'bun test' }, id: 'call-1', name: 'run_commands' }],
                    type: 'assistant',
                },
                { content: '1 pass', tool_call_id: 'call-1', type: 'tool_result' },
                { content: 'Implemented the fix.', model_id: 'grok-composer-2.5-fast', type: 'assistant' },
            ],
            current_model_id: 'grok-composer-2.5-fast',
            generated_title: 'Vendor detector review',
            info: { cwd: '/workspace/project', id: 'session-1' },
        };

        const [draft] = parseGrokPayload(payload)!;

        expect(draft).toMatchObject({
            id: 'session-1',
            model: 'grok-composer-2.5-fast',
            source: 'grok',
            title: 'Vendor detector review',
            workspacePath: '/workspace/project',
        });
        expect(draft.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'commentary', role: 'system', text: 'System prompt' },
            { phase: 'unknown', role: 'user', text: 'Review the vendor detector.' },
            { phase: 'reasoning', role: 'assistant', text: 'Inspecting the protected surface.' },
            { phase: 'tool_call', role: 'tool', text: 'run_commands\n{\n  "command": "bun test"\n}' },
            { phase: 'tool_output', role: 'tool', text: '1 pass' },
            { phase: 'final_answer', role: 'assistant', text: 'Implemented the fix.' },
        ]);
        expect(draft.messages[3]?.toolEvidence).toMatchObject({ callId: 'call-1', name: 'run_commands' });
    });

    it('should return null for unrelated payloads and reject malformed recognized history', () => {
        expect(parseGrokPayload({ answer: 'unrelated' })).toBeNull();
        expect(() => parseGrokPayload({ chat_history: 'bad' })).toThrow(/Grok payload chat_history/u);
        expect(() => parseGrokPayload([{ content: 'Answer', type: 'assistant' }, null])).toThrow(
            /Grok payload entries/u,
        );
    });
});
