import { describe, expect, it } from 'bun:test';
import {
    compactMessageText,
    formatToolOutputSummary,
    type MessageRecord,
    parseExecCommandArguments,
} from './codex-exporter';

describe('codex exporter transcript helpers', () => {
    it('drops preview wrappers from optimized message content', () => {
        const message: MessageRecord = {
            content: [
                {
                    text: ['Generated preview', '## Assistant', '', 'Actual answer'].join('\n\n'),
                    type: 'output_text',
                },
            ],
            role: 'assistant',
        };

        expect(compactMessageText(message, true)).toBe('Assistant\n\nActual answer');
    });

    it('extracts only stable command metadata from tool output', () => {
        const summary = formatToolOutputSummary(
            ['Command: echo hi', 'Chunk ID: abc', 'Process exited with code 0', 'Wall time: 0.1 seconds'].join('\n'),
            'txt',
        );

        expect(summary).toBe(['Command: echo hi', 'Process exited with code 0', 'Wall time: 0.1 seconds'].join('\n'));
    });

    it('parses exec_command arguments defensively', () => {
        expect(parseExecCommandArguments('{"cmd":"bun test","workdir":"/tmp/app"}')).toEqual({
            cmd: 'bun test',
            workdir: '/tmp/app',
        });
        expect(parseExecCommandArguments('{oops')).toEqual({
            cmd: null,
            workdir: null,
        });
    });
});
