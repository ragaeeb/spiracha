import { ANTIGRAVITY_TOOL_OUTPUT_PREVIEW_MAX_CHARACTERS } from '@spiracha/lib/antigravity-transcript-contract';
import { antigravityMarkdownToThreadEvents } from '@spiracha/lib/antigravity-transcript-events';
import { describe, expect, it } from 'vitest';
import { getThreadTranscriptStats } from './thread-transcript-stats';

const markdown = [
    '# Recover deleted sessions',
    '',
    '- exported_from: `antigravity_overview_transcript`',
    '- conversation_id: `conversation-1`',
    '',
    '## User',
    '',
    '_Timestamp: 2026-05-30T22:10:46Z_',
    '',
    'Can I recover deleted chats?',
    '',
    '## Assistant',
    '',
    '_Timestamp: 2026-05-30T22:10:47Z_',
    '',
    '### Thinking',
    '',
    'I should inspect the local data directory.',
    '',
    'I will inspect the local Antigravity data directory.',
    '',
    '### Tool Calls',
    '',
    '- `list_dir`',
    '',
    '```json',
    '{',
    '  "DirectoryPath": "/Users/example/.gemini/antigravity"',
    '}',
    '```',
    '',
    '## System',
    '',
    'Background event',
    '',
    '## Assistant',
    '',
    '_Timestamp: 2026-05-30T22:10:50Z_',
    '',
    'I found the recoverable local transcript files.',
    '',
].join('\n');

describe('antigravityMarkdownToThreadEvents', () => {
    it('should return no events for empty transcript markdown', () => {
        expect(antigravityMarkdownToThreadEvents(null)).toEqual([]);
        expect(antigravityMarkdownToThreadEvents('')).toEqual([]);
    });

    it('should adapt rendered Antigravity transcript markdown into transcript-view events', () => {
        const events = antigravityMarkdownToThreadEvents(markdown);

        expect(events.map((event) => event.kind)).toEqual([
            'message',
            'message',
            'message',
            'tool_call',
            'message',
            'message',
        ]);
        expect(events[0]).toMatchObject({
            kind: 'message',
            role: 'user',
            text: 'Can I recover deleted chats?',
            timestamp: '2026-05-30T22:10:46Z',
            variant: 'user_message',
        });
        expect(events[1]).toMatchObject({
            kind: 'message',
            phase: 'commentary',
            role: 'assistant',
            text: 'I should inspect the local data directory.',
            variant: 'agent_message',
        });
        expect(events[2]).toMatchObject({
            kind: 'message',
            phase: 'commentary',
            role: 'assistant',
            text: 'I will inspect the local Antigravity data directory.',
            variant: 'agent_message',
        });
        expect(events[3]).toMatchObject({
            argumentsText: '{\n  "DirectoryPath": "/Users/example/.gemini/antigravity"\n}',
            command: 'list_dir\n{\n  "DirectoryPath": "/Users/example/.gemini/antigravity"\n}',
            kind: 'tool_call',
            name: 'list_dir',
        });
        expect(events[4]).toMatchObject({
            isHiddenByDefault: true,
            kind: 'message',
            role: 'system',
            text: 'Background event',
        });
        expect(events[5]).toMatchObject({
            kind: 'message',
            phase: 'final_answer',
            role: 'assistant',
            text: 'I found the recoverable local transcript files.',
            variant: 'agent_message',
        });
    });

    it('should adapt Antigravity operation results as tool outputs instead of final answers', () => {
        const events = antigravityMarkdownToThreadEvents(
            [
                '# Reviewing docs',
                '',
                '## User',
                '',
                '_Timestamp: 2026-06-07T03:10:02Z_',
                '',
                'Review README.md',
                '',
                '## Assistant',
                '',
                '_Timestamp: 2026-06-07T03:10:04Z_',
                '',
                '### Thinking',
                '',
                'Let me read the requested file.',
                '',
                '### Tool Calls',
                '',
                '- `view_file`',
                '',
                '```json',
                '{',
                '  "AbsolutePath": "/Users/example/README.md"',
                '}',
                '```',
                '',
                '## Tool: VIEW_FILE',
                '',
                '_Timestamp: 2026-06-07T03:10:07Z_',
                '',
                'Created At: 2026-06-07T03:10:07Z',
                'Completed At: 2026-06-07T03:10:08Z',
                'File Path: `file://README.md`',
                'Total Lines: 226',
                '1: # Demo',
                '',
                '## Assistant',
                '',
                '_Timestamp: 2026-06-07T03:10:09Z_',
                '',
                'Now let me check the dispatch prompt path reference:',
                '',
                '### Tool Calls',
                '',
                '- `grep_search`',
                '',
                '```json',
                '{',
                '  "Query": "analytics"',
                '}',
                '```',
                '',
                '## Assistant',
                '',
                '_Timestamp: 2026-06-07T03:10:10Z_',
                '',
                'I found the README issue.',
                '',
            ].join('\n'),
        );

        expect(events.map((event) => event.kind)).toEqual([
            'message',
            'message',
            'tool_call',
            'tool_output',
            'message',
            'tool_call',
            'message',
        ]);
        expect(events[3]).toMatchObject({
            kind: 'tool_output',
            outputText: expect.stringContaining('File Path: `file://README.md`'),
            summary: expect.stringContaining('File Path: `file://README.md`'),
        });
        expect(events[4]).toMatchObject({
            kind: 'message',
            phase: 'commentary',
            role: 'assistant',
            text: 'Now let me check the dispatch prompt path reference:',
        });
        expect(events[6]).toMatchObject({
            kind: 'message',
            phase: 'final_answer',
            role: 'assistant',
            text: 'I found the README issue.',
        });
        expect(events).not.toContainEqual(
            expect.objectContaining({
                kind: 'message',
                phase: 'final_answer',
                text: expect.stringContaining('File Path: `file://README.md`'),
            }),
        );
    });

    it('should adapt trajectory command metadata into paired command and output events', () => {
        const events = antigravityMarkdownToThreadEvents(
            [
                '## Assistant',
                '',
                '### Thinking',
                '',
                'Confirming Test Drive Success',
                '',
                '### Tool Calls',
                '',
                '- `run_command`',
                '',
                'Call ID: `call-capabilities`',
                '',
                'Input:',
                '',
                '```',
                '{"CommandLine":"command -v kodeguard && kodeguard capabilities --json","Cwd":"/workspace/ushman"}',
                '```',
                '',
                '## Tool: RUN_COMMAND',
                '',
                'Call ID: `call-capabilities`',
                '',
                'Exit code: 0',
                '',
                '/Users/example/.bun/bin/kodeguard',
                '{"schemaVersion":"kodeguard/capabilities/v13"}',
            ].join('\n'),
        );

        expect(events).toContainEqual(
            expect.objectContaining({
                callId: 'call-capabilities',
                command: 'command -v kodeguard && kodeguard capabilities --json',
                kind: 'tool_call',
                workdir: '/workspace/ushman',
            }),
        );
        expect(events).toContainEqual(
            expect.objectContaining({
                callId: 'call-capabilities',
                exitCode: 0,
                kind: 'tool_output',
                outputText: expect.stringContaining('kodeguard/capabilities/v13'),
            }),
        );
        expect(events).toContainEqual(
            expect.objectContaining({
                kind: 'message',
                phase: 'commentary',
                text: 'Confirming Test Drive Success',
            }),
        );
    });

    it('should retain metadata-only command results without inventing placeholder output', () => {
        const events = antigravityMarkdownToThreadEvents(
            ['## Tool: RUN_COMMAND', '', 'Call ID: `call-empty`', '', 'Exit code: 0', ''].join('\n'),
        );

        expect(events).toEqual([
            expect.objectContaining({
                callId: 'call-empty',
                exitCode: 0,
                kind: 'tool_output',
                outputText: '',
                summary: '',
            }),
        ]);
    });

    it('should preserve legacy tool output that begins with metadata-like text', () => {
        const events = antigravityMarkdownToThreadEvents(
            ['## Tool: RUN_COMMAND', '', 'Exit code: 7', 'Actual legacy output'].join('\n'),
        );

        expect(events).toEqual([
            expect.objectContaining({
                callId: null,
                exitCode: null,
                kind: 'tool_output',
                outputText: 'Exit code: 7\nActual legacy output',
            }),
        ]);
    });

    it('should keep markdown headings inside assistant answers visible as assistant text', () => {
        const events = antigravityMarkdownToThreadEvents(
            [
                '## User',
                '',
                'Review the advisor implementation',
                '',
                '## Assistant',
                '',
                '_Timestamp: 2026-07-08T21:56:58Z_',
                '',
                'I now have a comprehensive view.',
                '',
                '## Consolidated Code Review',
                '',
                'The transaction policy object is emitted in the advisor JSON.',
                '',
                '### Finding 1',
                '',
                'The field is emitted in the advisor but not consumed locally.',
                '',
            ].join('\n'),
        );

        expect(events).toContainEqual(
            expect.objectContaining({
                isHiddenByDefault: false,
                kind: 'message',
                phase: 'final_answer',
                role: 'assistant',
                text: expect.stringContaining('emitted in the advisor'),
            }),
        );
        expect(events).not.toContainEqual(
            expect.objectContaining({
                isHiddenByDefault: true,
                role: 'event',
                text: expect.stringContaining('emitted in the advisor'),
            }),
        );
    });

    it('should not split transcript sections on headings inside fenced code blocks', () => {
        const events = antigravityMarkdownToThreadEvents(
            [
                '## User',
                '',
                'Show the example',
                '',
                '## Assistant',
                '',
                '```markdown',
                '## User',
                'This is sample text, not a transcript turn.',
                '```',
                '',
                'The example is complete.',
            ].join('\n'),
        );

        expect(events.filter((event) => event.kind === 'message' && event.role === 'user')).toHaveLength(1);
        expect(events).toContainEqual(
            expect.objectContaining({
                kind: 'message',
                phase: 'final_answer',
                text: expect.stringContaining('## User'),
            }),
        );
    });

    it('should not promote pre-tool assistant text to final answer when the transcript ends after tool use', () => {
        const events = antigravityMarkdownToThreadEvents(
            [
                '## User',
                '',
                'Review docs',
                '',
                '## Assistant',
                '',
                '_Timestamp: 2026-06-07T03:10:09Z_',
                '',
                'Now let me check the dispatch prompt path reference:',
                '',
                '### Tool Calls',
                '',
                '- `grep_search`',
                '',
                '```json',
                '{',
                '  "Query": "analytics"',
                '}',
                '```',
                '',
                '## Tool: GREP_SEARCH',
                '',
                'No results found',
                '',
            ].join('\n'),
        );

        expect(events).toContainEqual(
            expect.objectContaining({
                kind: 'message',
                phase: 'commentary',
                role: 'assistant',
                text: 'Now let me check the dispatch prompt path reference:',
            }),
        );
        expect(events).not.toContainEqual(expect.objectContaining({ kind: 'message', phase: 'final_answer' }));
        expect(events).toContainEqual(
            expect.objectContaining({
                kind: 'tool_output',
                outputText: 'No results found',
            }),
        );
    });

    it('should bound large tool-output previews while retaining the complete output', () => {
        const fullOutput = 'x'.repeat(ANTIGRAVITY_TOOL_OUTPUT_PREVIEW_MAX_CHARACTERS + 73);
        const [event] = antigravityMarkdownToThreadEvents(`## Tool: READ_FILE\n\n${fullOutput}`);

        expect(event).toMatchObject({
            kind: 'tool_output',
            outputText: fullOutput,
            raw: {
                outputCharacterCount: fullOutput.length,
                outputPreviewTruncated: true,
            },
        });
        expect(event?.kind === 'tool_output' ? event.summary.length : 0).toBeLessThanOrEqual(
            ANTIGRAVITY_TOOL_OUTPUT_PREVIEW_MAX_CHARACTERS,
        );
        expect(event?.kind === 'tool_output' ? event.summary : '').toContain(
            `full ${fullOutput.length}-character output`,
        );
    });
});

describe('getAntigravityThreadTranscriptStats', () => {
    it('should count adapted Antigravity transcript events for metadata panels', () => {
        const stats = getThreadTranscriptStats(antigravityMarkdownToThreadEvents(markdown));

        expect(stats).toMatchObject({
            assistantMessageCount: 3,
            commentaryCount: 2,
            finalAnswerCount: 1,
            messageCount: 5,
            toolCallCount: 1,
            userMessageCount: 1,
        });
    });

    it('should not count Antigravity operation results as final answers', () => {
        const stats = getThreadTranscriptStats(
            antigravityMarkdownToThreadEvents(
                [
                    '## User',
                    '',
                    'Review docs',
                    '',
                    '## Tool: VIEW_FILE',
                    '',
                    'Created At: 2026-06-07T03:10:07Z',
                    'File Path: `file://README.md`',
                    '1: # Demo',
                    '',
                ].join('\n'),
            ),
        );

        expect(stats).toMatchObject({
            finalAnswerCount: 0,
            messageCount: 1,
            toolOutputCount: 1,
        });
    });
});

describe('Antigravity transcript event ordering', () => {
    it('should keep event sequences unique across sections with many tool calls', () => {
        const toolCalls = Array.from({ length: 12 }, (_value, index) => `- \`tool_${index}\``);
        const events = antigravityMarkdownToThreadEvents(
            ['## Assistant', '', 'Working', '', '### Tool Calls', '', ...toolCalls, '', '## User', '', 'Continue'].join(
                '\n',
            ),
        );
        const sequences = events.map((event) => event.sequence);

        expect(new Set(sequences).size).toBe(sequences.length);
    });
});
