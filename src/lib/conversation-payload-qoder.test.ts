import { describe, expect, it } from 'bun:test';
import { parseQoderPayload } from './conversation-payload-qoder';

describe('Qoder payload parser', () => {
    it('should parse CLI JSONL records with reasoning, tools, and model labels', () => {
        const payload = [
            {
                created_at: '2026-08-08T00:00:00.000Z',
                id: 'user-1',
                parts: [{ text: 'Review the vendor detector.', type: 'text' }],
                role: 'user',
                session_id: 'session-1',
            },
            {
                id: 'assistant-1',
                model: 'qmodel',
                parts: [{ thinking: 'Inspect the protected surface.', type: 'thinking' }],
                role: 'assistant',
                session_id: 'session-1',
            },
            {
                id: 'assistant-2',
                model: 'qmodel',
                parts: [{ text: 'I will inspect the relevant files.', type: 'text' }],
                role: 'assistant',
                session_id: 'session-1',
            },
            {
                id: 'tool-1',
                parts: [
                    {
                        data: { id: 'call-1', input: { command: 'bun test' }, name: 'run_commands' },
                        type: 'tool_call',
                    },
                ],
                role: 'assistant',
                session_id: 'session-1',
            },
            {
                id: 'tool-output-1',
                parts: [{ content: '1 pass', tool_use_id: 'call-1', type: 'tool_result' }],
                role: 'tool',
                session_id: 'session-1',
            },
            {
                id: 'assistant-3',
                model: 'qmodel',
                parts: [{ text: 'Implemented the fix.', type: 'text' }],
                role: 'assistant',
                session_id: 'session-1',
            },
        ];

        const [draft] = parseQoderPayload(payload)!;

        expect(draft).toMatchObject({
            model: 'Qwen 3.7 Plus',
            source: 'qoder',
            title: 'Review the vendor detector.',
        });
        expect(draft.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Review the vendor detector.' },
            { phase: 'commentary', role: 'assistant', text: 'Inspect the protected surface.' },
            { phase: 'commentary', role: 'assistant', text: 'I will inspect the relevant files.' },
            { phase: 'tool_call', role: 'tool', text: 'run_commands\n{\n  "command": "bun test"\n}' },
            { phase: 'tool_output', role: 'tool', text: '1 pass' },
            { phase: 'final_answer', role: 'assistant', text: 'Implemented the fix.' },
        ]);
        expect(draft.messages[3]?.toolEvidence).toMatchObject({ callId: 'call-1', name: 'run_commands' });
    });

    it('should parse exported ACP JSON-RPC updates with streamed reasoning and model metadata', () => {
        const update = (sessionUpdate: string, content: unknown, extra: Record<string, unknown> = {}) => ({
            method: 'session/update',
            params: {
                _meta: { 'ai-coding/request-id': 'request-1' },
                sessionId: 'acp-session',
                update: { content, sessionUpdate, ...extra },
            },
        });
        const [draft] = parseQoderPayload([
            update('user_message_chunk', { text: 'Review the vendor detector.' }),
            update('agent_thought_chunk', { text: 'Inspect the protected surface.' }),
            update('agent_message_chunk', { text: 'Implemented the fix.' }),
            update('current_model_update', null, { modelId: 'qmodel' }),
        ])!;

        expect(draft).toMatchObject({
            id: 'acp-session',
            metadata: { requestId: 'request-1' },
            model: 'Qwen 3.7 Plus',
        });
        expect(draft.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Review the vendor detector.' },
            { phase: 'commentary', role: 'assistant', text: 'Inspect the protected surface.' },
            { phase: 'final_answer', role: 'assistant', text: 'Implemented the fix.' },
        ]);
    });

    it('should return null for unrelated payloads and reject incomplete recognized payloads', () => {
        expect(parseQoderPayload({ answer: 'unrelated' })).toBeNull();
        expect(
            parseQoderPayload({
                conversationId: 'antigravity-session',
                entries: [{ content: 'Consumer answer', source: 'MODEL', step_index: 0, type: 'PLANNER_RESPONSE' }],
            }),
        ).toBeNull();
        expect(() => parseQoderPayload({ entries: [], sessionId: 'session-1' }, 'qoder')).toThrow(
            /Qoder payload has no transcript entries/u,
        );
        expect(() =>
            parseQoderPayload([
                { parts: [{ text: 'Answer', type: 'text' }], provider: 'qoder', role: 'assistant' },
                null,
            ]),
        ).toThrow(/Qoder payload entries/u);
    });
});
