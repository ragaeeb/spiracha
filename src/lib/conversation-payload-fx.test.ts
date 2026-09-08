import { describe, expect, it } from 'bun:test';
import { parseFxPayload } from './conversation-payload-fx';

describe('parseFxPayload', () => {
    it('should parse a self-contained FX checkpoint and event bundle', () => {
        const drafts = parseFxPayload({
            checkpoint: {
                schema_version: 1,
                state: {
                    created_at_ms: 1_787_000_000_000,
                    history: [],
                    preferences: { effort: 'high', model: 'anthropic/claude-sonnet-4.5' },
                    updated_at_ms: 1_787_000_000_000,
                    workspace_root: '/workspace',
                },
                through_seq: 0,
            },
            display: { title: 'FX review' },
            events: [
                {
                    kind: 'history_turn_committed',
                    payload: {
                        turn: {
                            assistant: 'The review is complete.',
                            execution: {
                                tool_steps: [
                                    {
                                        assistant: 'I will inspect the file.',
                                        tool_calls: [
                                            {
                                                arguments_json: JSON.stringify({ command: 'sed -n 1,20p file.ts' }),
                                                id: 'call-1',
                                                name: 'bash',
                                            },
                                        ],
                                        tool_results: [
                                            {
                                                output_handle: 'result-1.txt',
                                                status: 'success',
                                                tool_call_id: 'call-1',
                                            },
                                        ],
                                    },
                                ],
                            },
                            user: { text: 'Review file.ts.' },
                        },
                    },
                    seq: 1,
                    timestamp_ms: 1_787_000_000_010,
                },
            ],
            session: {
                created_at_ms: 1_787_000_000_000,
                id: 'fx-payload-1',
                preferences: { effort: 'high', model: 'anthropic/claude-sonnet-4.5' },
                updated_at_ms: 1_787_000_000_020,
                workspace_root: '/workspace',
            },
            toolResults: { 'result-1.txt': 'const value = 1;\n' },
        });

        expect(drafts).toHaveLength(1);
        expect(drafts?.[0]).toMatchObject({
            id: 'fx-payload-1',
            model: 'anthropic/claude-sonnet-4.5',
            source: 'fx',
            title: 'FX review',
            workspacePath: '/workspace',
        });
        expect(drafts?.[0]?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'commentary', role: 'assistant', text: 'I will inspect the file.' }),
                expect.objectContaining({
                    phase: 'tool_call',
                    text: 'bash\n{"command":"sed -n 1,20p file.ts"}',
                }),
                expect.objectContaining({ phase: 'tool_output', text: 'const value = 1;' }),
                expect.objectContaining({ phase: 'final_answer', role: 'assistant', text: 'The review is complete.' }),
            ]),
        );
    });

    it('should reject a recognized FX session without its checkpoint or event log', () => {
        expect(() =>
            parseFxPayload(
                {
                    session: { id: 'fx-incomplete', workspace_root: '/workspace' },
                },
                'fx',
            ),
        ).toThrow('FX payload is missing checkpoint and event data');
    });

    it('should reject an event log that has no session metadata', () => {
        expect(() =>
            parseFxPayload({
                events: [{ kind: 'recovery_checkpoint_set', payload: {}, seq: 1 }],
            }),
        ).toThrow('FX payload event data is missing session metadata');
    });

    it('should parse a raw checkpoint object without a wrapper file name', () => {
        const drafts = parseFxPayload({
            schema_version: 1,
            state: {
                history: [
                    {
                        assistant: 'Checkpoint response.',
                        user: { text: 'Checkpoint request.' },
                    },
                ],
                id: 'fx-checkpoint-1',
                preferences: { model: 'openai/gpt-5.4' },
                workspace_root: '/workspace',
            },
            through_seq: 0,
        });

        expect(drafts?.[0]).toMatchObject({
            id: 'fx-checkpoint-1',
            model: 'openai/gpt-5.4',
            source: 'fx',
            workspacePath: '/workspace',
        });
        expect(drafts?.[0]?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'final_answer', text: 'Checkpoint response.' }),
                expect.objectContaining({ role: 'user', text: 'Checkpoint request.' }),
            ]),
        );
    });

    it('should parse complete committed turns without session metadata', () => {
        const drafts = parseFxPayload([
            {
                kind: 'history_turn_committed',
                payload: {
                    turn: {
                        assistant: 'The standalone event is complete.',
                        user: { text: 'Import this event.' },
                    },
                },
                seq: 1,
            },
        ]);

        expect(drafts?.[0]).toMatchObject({ source: 'fx', workspacePath: null });
        expect(drafts?.[0]?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'final_answer', text: 'The standalone event is complete.' }),
            ]),
        );
    });

    it('should leave a generic session and messages payload for its native parser', () => {
        expect(
            parseFxPayload({
                messages: [{ content: 'OpenCode content', role: 'assistant' }],
                session: { id: 'opencode-session', worktree: '/workspace' },
            }),
        ).toBeNull();
    });

    it('should return null for an unrelated payload', () => {
        expect(parseFxPayload({ hello: 'world' })).toBeNull();
    });
});
