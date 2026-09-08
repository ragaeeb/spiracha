import { describe, expect, it } from 'bun:test';
import { parseAntigravityPayload } from './conversation-payload-antigravity';

describe('parseAntigravityPayload', () => {
    it('should parse self-contained Antigravity transcript JSONL', () => {
        const [draft] = parseAntigravityPayload({
            conversationId: 'agy-1',
            model: 'gemini-3-pro',
            title: 'Ship the fix',
            transcript: [
                {
                    content: '<USER_REQUEST>Fix the export</USER_REQUEST>',
                    source: 'USER_EXPLICIT',
                    step_index: 1,
                    type: 'USER_INPUT',
                },
                {
                    content: 'I will inspect the file.',
                    model: 'gemini-3-pro',
                    source: 'MODEL',
                    step_index: 2,
                    thinking: 'Checking the export path.',
                    tool_calls: [{ args: { CommandLine: 'cat src/index.ts' }, id: 'call-1', name: 'run_command' }],
                    type: 'PLANNER_RESPONSE',
                },
                {
                    command: 'cat src/index.ts',
                    content: 'source',
                    exit_code: 0,
                    source: 'MODEL',
                    status: 'DONE',
                    step_index: 3,
                    tool_call_id: 'call-1',
                    tool_name: 'run_command',
                    type: 'RUN_COMMAND',
                    workdir: '/repo',
                },
                { content: 'Export fixed.', source: 'MODEL', step_index: 4, type: 'PLANNER_RESPONSE' },
            ],
            workspaceFolder: '/repo',
        })!;

        expect(draft).toMatchObject({
            id: 'agy-1',
            model: 'gemini-3-pro',
            source: 'antigravity',
            title: 'Ship the fix',
            workspacePath: '/repo',
        });
        expect(draft?.messages.map(({ phase, role, text }) => ({ phase, role, text }))).toEqual([
            { phase: 'unknown', role: 'user', text: 'Fix the export' },
            { phase: 'reasoning', role: 'assistant', text: 'Checking the export path.' },
            { phase: 'commentary', role: 'assistant', text: 'I will inspect the file.' },
            {
                phase: 'tool_call',
                role: 'tool',
                text: '{"args":{"CommandLine":"cat src/index.ts"},"id":"call-1","name":"run_command"}',
            },
            { phase: 'tool_output', role: 'tool', text: 'source' },
            { phase: 'final_answer', role: 'assistant', text: 'Export fixed.' },
        ]);
        expect(draft?.messages[4]?.toolEvidence).toMatchObject({
            callId: 'call-1',
            command: 'cat src/index.ts',
            exitCode: 0,
            name: 'run_command',
            outputText: 'source',
            status: 'succeeded',
            workdir: '/repo',
        });
    });

    it('should preserve inline artifacts and reject external or binary Antigravity payloads', () => {
        const [draft] = parseAntigravityPayload({
            artifacts: [{ content: '# Result', id: 'artifact-1', name: 'README.md' }],
            conversationId: 'agy-2',
            entries: [{ content: 'Done', source: 'MODEL', type: 'PLANNER_RESPONSE' }],
        })!;
        expect(draft?.artifacts).toEqual([{ content: '# Result', id: 'artifact-1', title: 'README.md' }]);
        expect(() =>
            parseAntigravityPayload({ conversationId: 'agy-3', transcriptPath: '/tmp/transcript.jsonl' }),
        ).toThrow('external');
        expect(() => parseAntigravityPayload(new Uint8Array([1, 2, 3]))).toThrow('protobuf');
    });

    it('should reject duplicate Antigravity conversations and return null for unrelated data', () => {
        expect(() =>
            parseAntigravityPayload([
                { conversationId: 'same', entries: [{ content: 'one', source: 'USER', type: 'USER_INPUT' }] },
                { conversationId: 'same', entries: [{ content: 'two', source: 'USER', type: 'USER_INPUT' }] },
            ]),
        ).toThrow('duplicate');
        expect(parseAntigravityPayload({ messages: [{ content: 'unrelated', role: 'user' }] })).toBeNull();
    });
});
