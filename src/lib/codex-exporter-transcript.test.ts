import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    compactMessageText,
    convertSessionFile,
    formatToolOutputSummary,
    type MessageRecord,
    parseExecCommandArguments,
} from './codex-exporter';
import { createCodexFixture } from './codex-test-helpers';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('codex exporter transcript helpers', () => {
    it('drops preview wrappers from optimized message content', () => {
        const message: MessageRecord = {
            content: [
                {
                    text: ['Generated preview', '## GPT 5.4', '', 'Actual answer'].join('\n\n'),
                    type: 'output_text',
                },
            ],
            model: 'gpt-5.4',
            role: 'assistant',
        };

        expect(compactMessageText(message, true)).toBe('GPT 5.4\n\nActual answer');
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
            argumentsParseFailed: false,
            cmd: 'bun test',
            workdir: '/tmp/app',
        });
        expect(parseExecCommandArguments('{oops')).toEqual({
            argumentsParseFailed: true,
            cmd: null,
            workdir: null,
        });
    });

    it('uses the assistant model name in exported thread content when available', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exporter-transcript-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        const content = await convertSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Test export.md',
                relations: {
                    childEdges: [],
                    parentThreadId: null,
                },
                sessionFile: fixture.sessionFile,
                thread: null,
            },
            {
                cwdFilter: null,
                dbPath: fixture.dbPath,
                flat: false,
                includeCommentary: true,
                includeTools: false,
                inputDir: fixture.inputDir,
                optimized: false,
                outputDir: fixture.outputDir,
                outputFormat: 'md',
                projectFilter: null,
                threadIds: [fixture.threadId],
            },
        );

        expect(content).toContain('## GPT 5.4');
        expect(content).not.toContain('## Assistant');
    });
});
