import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getThreadBrowseData } from './codex-browser-db';
import {
    compactMessageText,
    convertSessionFile,
    formatToolOutputSummary,
    type MessageRecord,
    parseExecCommandArguments,
} from './codex-exporter';
import { writeSessionFileExport } from './codex-exporter-transcript';
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

    it('should fall back to the thread model when inline transcript messages omit their model field', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exporter-transcript-thread-model-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        await Bun.write(
            fixture.sessionFile,
            [
                JSON.stringify({
                    payload: {
                        cli_version: '0.1.0',
                        cwd: fixture.cwd,
                        id: fixture.threadId,
                        originator: 'codex_cli_rs',
                        source: 'vscode',
                        timestamp: '2026-04-23T10:00:00.000Z',
                    },
                    type: 'session_meta',
                }),
                JSON.stringify({
                    payload: {
                        message: 'Thread-level model fallback should be used here.',
                        phase: 'final',
                        type: 'agent_message',
                    },
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const browseData = getThreadBrowseData(fixture.dbPath, fixture.threadId);
        const content = await convertSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Test export.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
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

    it('should omit hidden messages, unsupported tools, and commentary when exporting a rich transcript', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exporter-transcript-rich-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        await Bun.write(
            fixture.sessionFile,
            [
                JSON.stringify({
                    payload: {
                        cli_version: '0.1.0',
                        cwd: fixture.cwd,
                        id: fixture.threadId,
                        originator: 'codex_cli_rs',
                        source: 'vscode',
                        timestamp: '2026-04-23T10:00:00.000Z',
                    },
                    type: 'session_meta',
                }),
                JSON.stringify({
                    content: [{ text: '<environment_context>', type: 'input_text' }],
                    role: 'user',
                    type: 'message',
                }),
                JSON.stringify({
                    payload: {
                        message: 'User from response item',
                        type: 'user_message',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        message: 'Hidden commentary',
                        phase: 'commentary',
                        type: 'agent_message',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        content: [{ text: 'Final answer body', type: 'output_text' }],
                        model: 'gpt-5.5',
                        role: 'assistant',
                        type: 'message',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        arguments: '{}',
                        call_id: 'ignored-tool',
                        name: 'search_repo',
                        type: 'function_call',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        arguments: '{"cmd":"bun test","workdir":"/tmp/app"}',
                        call_id: 'tool-1',
                        name: 'exec_command',
                        type: 'function_call',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'tool-1',
                        output: 'unstructured output',
                        type: 'function_call_output',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'tool-1',
                        output: 'Command: bun test\nProcess exited with code 0\nWall time: 0.1 seconds',
                        type: 'function_call_output',
                    },
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const browseData = getThreadBrowseData(fixture.dbPath, fixture.threadId);
        const content = await convertSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Test export.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                cwdFilter: null,
                dbPath: fixture.dbPath,
                flat: false,
                includeCommentary: false,
                includeTools: true,
                inputDir: fixture.inputDir,
                optimized: false,
                outputDir: fixture.outputDir,
                outputFormat: 'md',
                projectFilter: null,
                threadIds: [fixture.threadId],
            },
        );

        expect(content).toContain('## User');
        expect(content).toContain('User from response item');
        expect(content).toContain('## GPT 5.5');
        expect(content).toContain('Final answer body');
        expect(content).toContain('## Tool');
        expect(content).toContain('Command: `bun test`');
        expect(content).toContain('## Tool Output');
        expect(content).not.toContain('Hidden commentary');
        expect(content).not.toContain('search_repo');
        expect(content).not.toContain('unstructured output');
    });

    it('should support optimized transcript export and transformed streaming output', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exporter-transcript-optimized-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);
        const outputPath = path.join(tempRoot, 'streamed.md');

        await Bun.write(
            fixture.sessionFile,
            [
                JSON.stringify({
                    payload: {
                        cli_version: '0.1.0',
                        cwd: fixture.cwd,
                        id: fixture.threadId,
                        originator: 'codex_cli_rs',
                        source: 'vscode',
                        timestamp: '2026-04-23T10:00:00.000Z',
                    },
                    type: 'session_meta',
                }),
                JSON.stringify({
                    payload: {
                        message: 'AGENTS.md instructions for /tmp/project',
                        type: 'user_message',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        message: 'Commentary that should be hidden',
                        phase: 'commentary',
                        type: 'agent_message',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        message: 'Actual request',
                        type: 'user_message',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        arguments: '{"cmd":"bun test","workdir":"/tmp/app"}',
                        call_id: 'tool-1',
                        name: 'exec_command',
                        type: 'function_call',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'tool-1',
                        output: 'Command: bun test\nProcess exited with code 0\nWall time: 0.1 seconds',
                        type: 'function_call_output',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        content: [{ text: '## Assistant\n\nFinal **answer**', type: 'output_text' }],
                        role: 'assistant',
                        type: 'message',
                    },
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const browseData = getThreadBrowseData(fixture.dbPath, fixture.threadId);
        const optimized = await convertSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Optimized.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                cwdFilter: null,
                dbPath: fixture.dbPath,
                flat: false,
                includeCommentary: false,
                includeTools: true,
                inputDir: fixture.inputDir,
                optimized: true,
                outputDir: fixture.outputDir,
                outputFormat: 'md',
                projectFilter: null,
                threadIds: [fixture.threadId],
            },
        );

        expect(optimized).toContain('U: Actual request');
        expect(optimized).toContain('GPT 5.4: Assistant');
        expect(optimized).toContain('Final answer');
        expect(optimized).toContain('T: exec_command `bun test` @ /tmp/app');
        expect(optimized).toContain('R: exited with code 0; wall time: 0.1 seconds');
        expect(optimized).not.toContain('Commentary that should be hidden');
        expect(optimized).not.toContain('AGENTS.md instructions');

        const saved = await writeSessionFileExport(
            {
                fallbackReason: null,
                outputRelativePath: 'Optimized.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                cwdFilter: null,
                dbPath: fixture.dbPath,
                flat: false,
                includeCommentary: false,
                includeTools: true,
                inputDir: fixture.inputDir,
                optimized: false,
                outputDir: fixture.outputDir,
                outputFormat: 'txt',
                projectFilter: null,
                threadIds: [fixture.threadId],
            },
            outputPath,
            (text) => text.replaceAll('Final', 'Final transformed'),
        );

        expect(saved).toBe(true);
        expect(await Bun.file(outputPath).text()).toContain('Final transformed **answer**');

        const skipped = await writeSessionFileExport(
            {
                fallbackReason: null,
                outputRelativePath: 'Optimized.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                cwdFilter: '/tmp/other-project',
                dbPath: fixture.dbPath,
                flat: false,
                includeCommentary: false,
                includeTools: true,
                inputDir: fixture.inputDir,
                optimized: false,
                outputDir: fixture.outputDir,
                outputFormat: 'txt',
                projectFilter: null,
                threadIds: [fixture.threadId],
            },
            path.join(tempRoot, 'filtered.txt'),
        );

        expect(skipped).toBe(false);
    });
});
