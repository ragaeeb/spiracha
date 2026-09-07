import { describe, expect, it } from 'bun:test';
import { parseOpenCodePayload } from './conversation-payload-opencode';

describe('parseOpenCodePayload', () => {
    it('should parse a self-contained OpenCode session export with reasoning and tools', () => {
        const [draft] = parseOpenCodePayload({
            messages: [
                {
                    id: 'msg-user',
                    parts: [{ data: { text: 'Review the export', type: 'text' }, id: 'part-user' }],
                    role: 'user',
                    timeCreated: 100,
                },
                {
                    id: 'msg-assistant',
                    parts: [
                        { data: { text: 'Inspecting.', type: 'reasoning' }, id: 'part-reasoning', timeCreated: 110 },
                        {
                            data: {
                                callID: 'call-1',
                                state: {
                                    input: { path: 'src/index.ts' },
                                    output: 'source',
                                    status: 'completed',
                                    time: { end: 130, start: 120 },
                                },
                                tool: 'read',
                                type: 'tool',
                            },
                            id: 'part-tool',
                            timeCreated: 120,
                        },
                        { data: { text: 'The export is fixed.', type: 'text' }, id: 'part-text', timeCreated: 140 },
                    ],
                    role: 'assistant',
                    timeCreated: 110,
                },
            ],
            session: {
                agent: 'build',
                id: 'ses-1',
                model: { id: 'openai/gpt-5.4', providerID: 'openai', variant: 'high' },
                timeCreated: 100,
                timeUpdated: 150,
                title: 'Export review',
                worktree: '/repo',
            },
        })!;

        expect(draft).toMatchObject({
            id: 'ses-1',
            model: 'openai/gpt-5.4',
            source: 'opencode',
            title: 'Export review',
            updatedAtMs: 150,
            workspacePath: '/repo',
        });
        expect(draft?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Review the export' },
            { phase: 'reasoning', role: 'assistant', text: 'Inspecting.' },
            { phase: 'tool_call', role: 'tool', text: 'read\n{\n  "path": "src/index.ts"\n}' },
            { phase: 'tool_output', role: 'tool', text: 'source' },
            { phase: 'final_answer', role: 'assistant', text: 'The export is fixed.' },
        ]);
        expect(draft?.messages[2]?.toolEvidence).toMatchObject({
            callId: 'call-1',
            durationMs: 10,
            inputText: '{\n  "path": "src/index.ts"\n}',
            name: 'read',
            outputText: null,
            status: 'succeeded',
        });
    });

    it('should split assistant think tags while preserving user literals', () => {
        const [draft] = parseOpenCodePayload(
            {
                id: 'ses-2',
                messages: [
                    {
                        id: 'u',
                        parts: [{ data: { text: '<think>literal</think>', type: 'text' }, id: 'up' }],
                        role: 'user',
                    },
                    {
                        id: 'a',
                        parts: [{ data: { text: '<think>private</think>Answer', type: 'text' }, id: 'ap' }],
                        role: 'assistant',
                    },
                ],
                title: 'Think tags',
            },
            'opencode',
        )!;
        expect(draft?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: '<think>literal</think>' },
            { phase: 'reasoning', role: 'assistant', text: 'private' },
            { phase: 'final_answer', role: 'assistant', text: 'Answer' },
        ]);
    });

    it('should parse OpenCode exported info records and preserve message model IDs', () => {
        const [draft] = parseOpenCodePayload({
            info: {
                id: 'ses-exported',
                time: { created: 1_000, updated: 2_000 },
                title: 'Exported session',
            },
            messages: [
                {
                    info: { id: 'msg-exported-user', role: 'user', time: { created: 1_100, updated: 1_100 } },
                    parts: [{ id: 'part-exported-user', text: 'Question', type: 'text' }],
                },
                {
                    info: {
                        id: 'msg-exported-assistant',
                        modelID: 'anthropic/claude-sonnet-4.5',
                        role: 'assistant',
                        time: { created: 1_200, updated: 1_300 },
                    },
                    parts: [{ id: 'part-exported-assistant', text: 'Answer', type: 'text' }],
                },
            ],
        })!;
        expect(draft).toMatchObject({
            id: 'ses-exported',
            model: 'anthropic/claude-sonnet-4.5',
            title: 'Exported session',
        });
        expect(draft?.messages.at(-1)).toMatchObject({ phase: 'final_answer', role: 'assistant', text: 'Answer' });
    });

    it('should keep missing timestamps null instead of using the Unix epoch', () => {
        const [draft] = parseOpenCodePayload({
            messages: [{ id: 'm', parts: [{ data: { text: 'Answer', type: 'text' }, id: 'p' }], role: 'assistant' }],
            session: { id: 'ses-no-time' },
        })!;

        expect(draft).toMatchObject({ createdAtMs: null, id: 'ses-no-time', updatedAtMs: null });
        expect(draft?.messages[0]?.createdAtMs).toBeNull();
    });

    it('should reject malformed and duplicate OpenCode sessions', () => {
        expect(() => parseOpenCodePayload({ messages: [{ id: 'm', role: 'user' }], session: { id: 'bad' } })).toThrow(
            'OpenCode',
        );
        expect(() =>
            parseOpenCodePayload([
                { messages: [], session: { id: 'same', title: 'one' } },
                { messages: [], session: { id: 'same', title: 'two' } },
            ]),
        ).toThrow('duplicate');
    });
});
