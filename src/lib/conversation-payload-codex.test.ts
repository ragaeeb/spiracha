import { describe, expect, it } from 'bun:test';
import { parseCodexPayload } from './conversation-payload-codex';

describe('parseCodexPayload', () => {
    it('should parse a native Codex JSONL transcript into normalized messages', () => {
        const drafts = parseCodexPayload([
            {
                payload: {
                    cli_version: '1.2.3',
                    cwd: '/workspace/project',
                    id: 'codex-thread-1',
                    model_provider: 'openai',
                    timestamp: '2026-09-07T12:00:00.000Z',
                    type: 'session_meta',
                },
                type: 'session_meta',
            },
            { payload: { model: 'gpt-5.4' }, type: 'turn_context' },
            {
                payload: {
                    content: [{ text: 'Please inspect the project.', type: 'input_text' }],
                    role: 'user',
                    type: 'message',
                },
                timestamp: '2026-09-07T12:00:01.000Z',
                type: 'response_item',
            },
            {
                payload: { summary: ['Inspecting the project.'], type: 'reasoning' },
                timestamp: '2026-09-07T12:00:02.000Z',
                type: 'response_item',
            },
            {
                payload: {
                    arguments: '{"cmd":"rtk bun test"}',
                    call_id: 'call-1',
                    name: 'exec_command',
                    type: 'function_call',
                },
                timestamp: '2026-09-07T12:00:03.000Z',
                type: 'response_item',
            },
            {
                payload: {
                    call_id: 'call-1',
                    output: '12 tests passed',
                    type: 'function_call_output',
                },
                timestamp: '2026-09-07T12:00:04.000Z',
                type: 'response_item',
            },
            {
                payload: {
                    message: 'The project is healthy.',
                    model: 'gpt-5.4',
                    phase: 'final_answer',
                    type: 'agent_message',
                },
                timestamp: '2026-09-07T12:00:05.000Z',
                type: 'response_item',
            },
        ]);

        expect(drafts).toHaveLength(1);
        expect(drafts?.[0]).toMatchObject({
            createdAtMs: Date.parse('2026-09-07T12:00:00.000Z'),
            id: 'codex-thread-1',
            model: 'gpt-5.4',
            source: 'codex',
            updatedAtMs: Date.parse('2026-09-07T12:00:05.000Z'),
            workspacePath: '/workspace/project',
        });
        expect(drafts?.[0]?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'reasoning', role: 'assistant', text: 'Inspecting the project.' }),
                expect.objectContaining({ phase: 'tool_call', role: 'tool', text: 'rtk bun test' }),
                expect.objectContaining({ phase: 'tool_output', role: 'tool', text: '12 tests passed' }),
                expect.objectContaining({ phase: 'final_answer', role: 'assistant', text: 'The project is healthy.' }),
            ]),
        );
    });

    it('should parse a Codex Cloud task export using the existing Cloud event mapping', () => {
        const drafts = parseCodexPayload({
            current_assistant_turn: {
                created_at: '2026-09-07T12:00:00.000Z',
                id: 'turn-1',
                model: 'gpt-5.4',
                status: 'completed',
                thread_events: {
                    events: [
                        {
                            method: 'item/completed',
                            params: { item: { id: 'user-1', text: 'Fix the bug.', type: 'userMessage' } },
                        },
                        {
                            method: 'item/completed',
                            params: { item: { id: 'assistant-1', text: 'Fixed it.', type: 'agentMessage' } },
                        },
                    ],
                },
            },
            task: {
                created_at: '2026-09-07T11:59:00.000Z',
                id: 'task_e_1',
                title: 'Fix the bug',
                updated_at: '2026-09-07T12:01:00.000Z',
            },
        });

        expect(drafts).toHaveLength(1);
        expect(drafts?.[0]).toMatchObject({
            id: 'task_e_1',
            model: 'gpt-5.4',
            title: 'Fix the bug',
            updatedAtMs: Date.parse('2026-09-07T12:01:00.000Z'),
        });
        expect(drafts?.[0]?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'final_answer', role: 'assistant', text: 'Fixed it.' }),
            ]),
        );
    });

    it('should return null for an unrelated payload', () => {
        expect(parseCodexPayload({ hello: 'world' })).toBeNull();
    });

    it('should parse raw transcript events without optional session metadata', () => {
        const drafts = parseCodexPayload([
            {
                payload: {
                    content: [{ text: 'Work from the raw rollout.' }],
                    role: 'user',
                    type: 'message',
                },
                type: 'response_item',
            },
        ]);

        expect(drafts?.[0]).toMatchObject({
            id: null,
            source: 'codex',
            title: 'Work from the raw rollout.',
            workspacePath: null,
        });
    });

    it('should reject a recognized Codex payload with an invalid transcript record', () => {
        expect(() => parseCodexPayload({ payload: 'invalid', type: 'response_item' })).toThrow(
            'Codex payload has an invalid response_item',
        );
    });
});
