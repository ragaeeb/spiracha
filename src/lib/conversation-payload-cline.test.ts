import { describe, expect, it } from 'bun:test';
import { parseClinePayload } from './conversation-payload-cline';

describe('Cline payload parser', () => {
    it('should parse the stored messages envelope with Cline phases and tools', () => {
        const payload = {
            messages: [
                {
                    content: [{ text: 'Fix issue 1494', type: 'text' }],
                    id: 'user-1',
                    role: 'user',
                    ts: 1_786_147_200_000,
                },
                {
                    content: [
                        { thinking: 'Inspect the protected surface.', type: 'thinking' },
                        { text: 'I will inspect the relevant files.', type: 'text' },
                        {
                            id: 'call-1',
                            input: { commands: ['bun test'] },
                            name: 'run_commands',
                            type: 'tool_use',
                        },
                    ],
                    id: 'assistant-1',
                    role: 'assistant',
                    ts: 1_786_147_201_000,
                },
                {
                    content: [
                        {
                            content: [{ result: '1 pass', success: true }],
                            tool_use_id: 'call-1',
                            type: 'tool_result',
                        },
                    ],
                    id: 'tool-1',
                    role: 'user',
                    ts: 1_786_147_202_000,
                },
                {
                    content: [{ text: 'Implemented the fix.', type: 'text' }],
                    id: 'assistant-2',
                    role: 'assistant',
                    ts: 1_786_147_203_000,
                },
            ],
            metadata: { modelId: 'deepseek/deepseek-v4-flash', title: 'Fix issue 1494' },
            model: 'deepseek/deepseek-v4-flash',
            session_id: 'session-1',
            workspace_root: '/workspace/project',
        };

        const [draft] = parseClinePayload(payload)!;

        expect(draft).toMatchObject({
            id: 'session-1',
            model: 'deepseek/deepseek-v4-flash',
            source: 'cline',
            title: 'Fix issue 1494',
            workspacePath: '/workspace/project',
        });
        expect(draft.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Fix issue 1494' },
            { phase: 'reasoning', role: 'assistant', text: 'Inspect the protected surface.' },
            { phase: 'commentary', role: 'assistant', text: 'I will inspect the relevant files.' },
            { phase: 'tool_call', role: 'assistant', text: 'run_commands: {"commands":["bun test"]}' },
            { phase: 'tool_output', role: 'tool', text: '1 pass' },
            { phase: 'final_answer', role: 'assistant', text: 'Implemented the fix.' },
        ]);
        expect(draft.messages[3]?.toolEvidence).toMatchObject({
            callId: 'call-1',
            inputText: '{"commands":["bun test"]}',
            name: 'run_commands',
            workdir: '/workspace/project',
        });
    });

    it('should return null for unrelated payloads and reject malformed recognized messages', () => {
        expect(parseClinePayload({ answer: 'unrelated' })).toBeNull();
        expect(() => parseClinePayload({ messages: [{ content: 'not-an-array' }] }, 'cline')).toThrow(
            /Cline payload message content/u,
        );
        expect(() => parseClinePayload({ messages: [null], session_id: 'session-1' })).toThrow(
            /Cline payload message entries/u,
        );
    });
});
