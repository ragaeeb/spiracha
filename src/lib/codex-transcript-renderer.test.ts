import { afterEach, describe, expect, it } from 'bun:test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { getThreadBrowseData } from './codex-browser-db';
import { createCodexFixture } from './codex-test-helpers';
import {
    formatToolOutputSummary,
    parseExecCommandArguments,
    pipeCodexExportStream,
    renderCodexSessionFile,
    writeCodexSessionFileExport,
} from './codex-transcript-renderer';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('codex transcript renderer helpers', () => {
    it('should reject when the export destination fails while piping a transcript', async () => {
        const source = Readable.from(['transcript']);
        const destination = new Writable({
            write(_chunk, _encoding, callback) {
                callback(new Error('disk full'));
            },
        });

        await expect(pipeCodexExportStream(source, destination)).rejects.toThrow('disk full');
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
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-renderer-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        const content = await renderCodexSessionFile(
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
                includeCommentary: true,
                includeMetadata: true,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(content).toContain('## GPT 5.4');
        expect(content).not.toContain('## Assistant');
    });

    it('should fall back to the thread model when inline transcript messages omit their model field', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-renderer-thread-model-test-'));
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
        const content = await renderCodexSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Test export.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                includeCommentary: true,
                includeMetadata: true,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(content).toContain('## GPT 5.4');
        expect(content).not.toContain('## Assistant');
    });

    it('should omit hidden messages and commentary while exporting every tool record', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-renderer-rich-test-'));
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
        const content = await renderCodexSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Test export.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                includeCommentary: false,
                includeMetadata: true,
                includeTools: true,
                outputFormat: 'md',
            },
        );

        expect(content).toContain('## User');
        expect(content).toContain('User from response item');
        expect(content).toContain('## GPT 5.5');
        expect(content).toContain('Final answer body');
        expect(content).toContain('## Tool');
        expect(content).toContain('Command: `bun test`');
        expect(content).toContain('## Tool Output');
        expect(content).toContain('search_repo');
        expect(content).toContain('unstructured output');
        expect(content).not.toContain('Hidden commentary');
    });

    it('should render modern custom tools and generic legacy tools in inline and streaming exports', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-renderer-modern-tools-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);
        const outputPath = path.join(tempRoot, 'streamed.txt');

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
                        timestamp: '2026-07-17T12:00:00.000Z',
                    },
                    type: 'session_meta',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'custom-call-1',
                        input: 'const result = await tools.exec_command({ cmd: "rtk bun test" });',
                        name: 'exec',
                        type: 'custom_tool_call',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'custom-call-1',
                        output: [
                            { text: 'Script completed', type: 'input_text' },
                            { text: '12 tests passed', type: 'input_text' },
                        ],
                        type: 'custom_tool_call_output',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        arguments: '{"timeout_ms":30000}',
                        call_id: 'wait-call-1',
                        name: 'wait',
                        type: 'function_call',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        call_id: 'wait-call-1',
                        output: 'Wait finished without another message.',
                        type: 'function_call_output',
                    },
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const browseData = getThreadBrowseData(fixture.dbPath, fixture.threadId);
        const target = {
            fallbackReason: null,
            outputRelativePath: 'Transcript.md',
            relations: browseData.relations,
            sessionFile: fixture.sessionFile,
            thread: browseData.thread,
        };
        const content = await renderCodexSessionFile(target, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: true,
            outputFormat: 'md',
        });

        expect(content).toContain('Tool: `exec`');
        expect(content).toContain('tools.exec_command');
        expect(content).toContain('12 tests passed');
        expect(content).toContain('Tool: `wait`');
        expect(content).toContain('"timeout_ms":30000');
        expect(content).toContain('Wait finished without another message.');

        const saved = await writeCodexSessionFileExport(
            target,
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'txt',
            },
            outputPath,
        );

        expect(saved).toBe(true);
        const savedContent = await Bun.file(outputPath).text();
        expect(savedContent).toContain('Tool: exec');
        expect(savedContent).toContain('tools.exec_command');
        expect(savedContent).toContain('12 tests passed');
        expect(savedContent).toContain('Tool: wait');
        expect(savedContent).toContain('Wait finished without another message.');

        const withoutTools = await renderCodexSessionFile(target, {
            includeCommentary: false,
            includeMetadata: false,
            includeTools: false,
            outputFormat: 'md',
        });
        expect(withoutTools).toBeNull();
    });

    it('should omit Codex app directive lines from clean markdown exports', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-renderer-directives-test-'));
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
                        message: [
                            'Implemented the fix.',
                            '::git-stage{cwd="."}',
                            '::git-commit{cwd="."}',
                            '::git-stage{cwd="~/workspace/ushman-e2e"}',
                            '::git-commit{cwd="~/workspace/ushman-e2e"}',
                        ].join('\n'),
                        phase: 'final_answer',
                        type: 'agent_message',
                    },
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const browseData = getThreadBrowseData(fixture.dbPath, fixture.threadId);
        const content = await renderCodexSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Test export.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(content).toContain('Implemented the fix.');
        expect(content).not.toContain('::git-stage');
        expect(content).not.toContain('::git-commit');
    });

    it('should preserve an introductory paragraph before a markdown heading', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-renderer-heading-intro-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        await Bun.write(
            fixture.sessionFile,
            JSON.stringify({
                payload: {
                    message: 'Intro sentence.\n\n## Findings\n\nFirst finding.',
                    phase: 'final_answer',
                    type: 'agent_message',
                },
                type: 'response_item',
            }),
        );

        const browseData = getThreadBrowseData(fixture.dbPath, fixture.threadId);
        const content = await renderCodexSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Test export.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(content).toContain('Intro sentence.');
        expect(content).toContain('## Findings');
        expect(content).toContain('First finding.');
    });

    it('should omit memory citation XML and injected context records hidden by the transcript UI', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-renderer-hidden-context-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);

        await Bun.write(
            fixture.sessionFile,
            [
                JSON.stringify({
                    payload: {
                        message: '<permissions instructions>\nHidden sandbox policy\n</permissions instructions>',
                        type: 'user_message',
                    },
                    type: 'response_item',
                }),
                JSON.stringify({
                    payload: {
                        message: [
                            'Implemented the requested fix.',
                            '',
                            '<oai-mem-citation>',
                            '<citation_entries>',
                            'MEMORY.md:1-2|note=[hidden export metadata]',
                            '</citation_entries>',
                            '</oai-mem-citation>',
                        ].join('\n'),
                        phase: 'final_answer',
                        type: 'agent_message',
                    },
                    type: 'response_item',
                }),
            ].join('\n'),
        );

        const browseData = getThreadBrowseData(fixture.dbPath, fixture.threadId);
        const content = await renderCodexSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Test export.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(content).toContain('Implemented the requested fix.');
        expect(content).not.toContain('Hidden sandbox policy');
        expect(content).not.toContain('oai-mem-citation');
        expect(content).not.toContain('MEMORY.md:1-2');
    });

    it('should support metadata-free transcript export and transformed streaming output', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-renderer-metadata-test-'));
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
        const content = await renderCodexSessionFile(
            {
                fallbackReason: null,
                outputRelativePath: 'Transcript.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'md',
            },
        );

        expect(content).toContain('## User');
        expect(content).toContain('Actual request');
        expect(content).toContain('## GPT 5.4');
        expect(content).toContain('Final **answer**');
        expect(content).toContain('## Tool');
        expect(content).toContain('Command: `bun test`');
        expect(content).toContain('## Tool Output');
        expect(content).not.toContain('Metadata');
        expect(content).not.toContain('Commentary that should be hidden');
        expect(content).not.toContain('AGENTS.md instructions');

        const saved = await writeCodexSessionFileExport(
            {
                fallbackReason: null,
                outputRelativePath: 'Transcript.md',
                relations: browseData.relations,
                sessionFile: fixture.sessionFile,
                thread: browseData.thread,
            },
            {
                includeCommentary: false,
                includeMetadata: false,
                includeTools: true,
                outputFormat: 'txt',
            },
            outputPath,
            (text) => text.replaceAll('Final', 'Final transformed'),
        );

        expect(saved).toBe(true);
        const savedContent = await Bun.file(outputPath).text();
        expect(savedContent).toContain('Test export\n===========');
        expect(savedContent).toContain('Final transformed **answer**');
    });

    it('should clean up temporary files in writeCodexSessionFileExport when an error occurs', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-cleanup-test-'));
        tempPaths.push(tempRoot);

        const badTarget = {
            fallbackReason: null,
            outputRelativePath: 'Test.md',
            relations: { childEdges: [], parentThreadId: null },
            sessionFile: tempRoot,
            thread: null,
        };

        const badOptions = {
            includeCommentary: false,
            includeMetadata: true,
            includeTools: false,
            outputFormat: 'md' as const,
        };

        const targetOutputPath = path.join(tempRoot, 'output.md');
        const expectedTmpFile = `${targetOutputPath}.transcript.tmp`;

        let threw = false;
        try {
            await writeCodexSessionFileExport(badTarget, badOptions, targetOutputPath);
        } catch {
            threw = true;
        }

        expect(threw).toBe(true);

        const tmpFileExists = await access(expectedTmpFile)
            .then(() => true)
            .catch(() => false);
        expect(tmpFileExists).toBe(false);
    });
});
