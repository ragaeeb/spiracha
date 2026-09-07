import { describe, expect, it } from 'bun:test';
import { parseCursorPayload } from './conversation-payload-cursor';

describe('parseCursorPayload', () => {
    it('should parse a self-contained Cursor composer export into normalized messages', () => {
        const [draft] = parseCursorPayload({
            bubbles: [
                { bubbleId: 'u1', text: 'Fix the export', type: 1 },
                {
                    bubbleId: 'a1',
                    text: 'I will inspect the component first.',
                    thinking: { text: 'Inspecting the component.' },
                    toolFormerData: {
                        name: 'read_file',
                        rawArgs: '{"path":"src/index.ts"}',
                        result: 'source',
                        status: 'completed',
                        toolCallId: 'call-1',
                    },
                    type: 2,
                },
                { bubbleId: 'a2', text: 'Fixed the export behavior.', type: 2 },
            ],
            composerId: 'thread-1',
            createdAt: 100,
            lastUpdatedAt: 300,
            modelConfig: { modelName: 'claude-sonnet-4.5' },
            name: 'Export fix',
        })!;

        expect(draft).toMatchObject({
            createdAtMs: 100,
            id: 'thread-1',
            model: 'claude-sonnet-4.5',
            source: 'cursor',
            title: 'Export fix',
            updatedAtMs: 300,
        });
        expect(draft?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Fix the export' },
            { phase: 'reasoning', role: 'assistant', text: 'Inspecting the component.' },
            { phase: 'commentary', role: 'assistant', text: 'I will inspect the component first.' },
            { phase: 'tool_call', role: 'tool', text: 'read_file\n{"path":"src/index.ts"}' },
            { phase: 'tool_output', role: 'tool', text: 'source' },
            { phase: 'final_answer', role: 'assistant', text: 'Fixed the export behavior.' },
        ]);
        expect(draft?.messages[3]?.toolEvidence).toMatchObject({
            callId: 'call-1',
            inputText: '{"path":"src/index.ts"}',
            name: 'read_file',
            outputText: null,
            status: 'succeeded',
        });
    });

    it('should parse Cursor agent JSONL when an explicit source hint disambiguates roles', () => {
        const drafts = parseCursorPayload(
            [
                { message: { content: [{ text: 'Fix this', type: 'text' }], role: 'user' } },
                {
                    message: {
                        content: [
                            { text: 'Done.', type: 'text' },
                            { id: 'call-1', input: { path: 'src/index.ts' }, name: 'read', type: 'tool_use' },
                        ],
                        role: 'assistant',
                    },
                },
            ],
            'cursor',
        )!;

        expect(drafts).toHaveLength(1);
        expect(drafts[0]?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Fix this' },
            { phase: 'final_answer', role: 'assistant', text: 'Done.' },
            { phase: 'tool_call', role: 'tool', text: 'read\n{"path":"src/index.ts"}' },
        ]);
        expect(parseCursorPayload({ content: 'ambiguous', role: 'user' })).toBeNull();
        expect(
            parseCursorPayload([
                { content: [{ id: 'call', input: {}, name: 'read', type: 'tool_use' }], role: 'assistant' },
            ]),
        ).toBeNull();
    });

    it('should reject malformed and duplicate Cursor conversations', () => {
        expect(() => parseCursorPayload({ bubbles: [{ type: 1 }], composerId: 'bad' })).toThrow('Cursor');
        expect(() =>
            parseCursorPayload([
                { bubbles: [{ bubbleId: 'u1', text: 'one', type: 1 }], composerId: 'same' },
                { bubbles: [{ bubbleId: 'u2', text: 'two', type: 1 }], composerId: 'same' },
            ]),
        ).toThrow('duplicate');
    });
});
