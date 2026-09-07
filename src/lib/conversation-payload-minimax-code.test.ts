import { describe, expect, it } from 'bun:test';
import { parseMiniMaxCodePayload } from './conversation-payload-minimax-code';

describe('parseMiniMaxCodePayload', () => {
    it('should parse a MiniMax Code v2 snapshot with reasoning and tool evidence', () => {
        const drafts = parseMiniMaxCodePayload({
            displayMessages: [
                {
                    msg_content: 'Inspect the workspace.',
                    msg_id: 'user-1',
                    msg_type: 1,
                    role: 'user',
                    timestamp: 1_786_000_000_010,
                },
                {
                    finish_reason: 'toolUse',
                    msg_content: 'I will inspect it.',
                    msg_id: 'assistant-1',
                    msg_type: 2,
                    role: 'assistant',
                    thinking_content: 'I need the complete picture.',
                    timestamp: 1_786_000_000_020,
                    tool_calls: [
                        {
                            tool_call_args: JSON.stringify({ command: 'pwd' }),
                            tool_call_id: 'call-1',
                            tool_call_result_data: JSON.stringify({ content: [{ text: '/workspace' }] }),
                            tool_call_status: 2,
                            tool_name: 'bash',
                        },
                    ],
                },
                {
                    finish_reason: 'stop',
                    msg_content: 'The workspace is ready.',
                    msg_id: 'assistant-2',
                    msg_type: 2,
                    role: 'assistant',
                    timestamp: 1_786_000_000_030,
                },
            ],
            record: {
                createdAtMs: 1_786_000_000_000,
                effectiveModel: 'minimax/MiniMax-M3',
                effectiveModelVariant: 'thinking',
                sessionId: 'mvs_payload_1',
                status: 'finished',
                title: 'Workspace inspection',
                updatedAtMs: 1_786_000_000_040,
                workspaceDir: '/workspace',
            },
            schemaVersion: 1,
            sessionId: 'mvs_payload_1',
        });

        expect(drafts).toHaveLength(1);
        expect(drafts?.[0]).toMatchObject({
            createdAtMs: 1_786_000_000_000,
            id: 'mvs_payload_1',
            model: 'minimax/MiniMax-M3',
            source: 'minimax-code',
            title: 'Workspace inspection',
            workspacePath: '/workspace',
        });
        expect(drafts?.[0]?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'reasoning', text: 'I need the complete picture.' }),
                expect.objectContaining({ phase: 'tool_call', text: 'bash\n{"command":"pwd"}' }),
                expect.objectContaining({ phase: 'tool_output', text: '/workspace' }),
                expect.objectContaining({ phase: 'final_answer', text: 'The workspace is ready.' }),
            ]),
        );
    });

    it('should parse a self-contained MiniMax messages JSONL envelope', () => {
        const drafts = parseMiniMaxCodePayload({
            messages: [
                {
                    message: { content: [{ text: 'Review this file.' }], role: 'user', timestamp: 1 },
                    message_id: 'user-1',
                },
                {
                    message: {
                        content: [
                            { text: 'The file is ready for review.', type: 'text' },
                            { thinking: 'Reading the file.', type: 'thinking' },
                        ],
                        role: 'assistant',
                        stopReason: 'stop',
                        timestamp: 2,
                    },
                    message_id: 'assistant-1',
                },
            ],
            record: {
                effectiveModel: 'minimax/MiniMax-M3',
                sessionId: 'mvs_payload_2',
                title: 'File review',
                workspaceDir: '/workspace',
            },
        });

        expect(drafts?.[0]?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'reasoning', text: 'Reading the file.' }),
                expect.objectContaining({ phase: 'final_answer', role: 'assistant' }),
            ]),
        );
    });

    it('should parse a standalone MiniMax messages log with optional session metadata', () => {
        const drafts = parseMiniMaxCodePayload([
            { message: { content: [{ text: 'No session metadata.' }], role: 'user' }, message_id: 'user-1' },
        ]);

        expect(drafts?.[0]).toMatchObject({
            source: 'minimax-code',
            title: 'No session metadata.',
            workspacePath: null,
        });
    });

    it('should return null for an unrelated payload', () => {
        expect(parseMiniMaxCodePayload({ hello: 'world' })).toBeNull();
    });
});
