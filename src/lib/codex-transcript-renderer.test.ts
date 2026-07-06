import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getThreadBrowseData } from './codex-browser-db';
import { createCodexFixture } from './codex-test-helpers';
import {
    formatToolOutputSummary,
    parseExecCommandArguments,
    renderCodexSessionFile,
    writeCodexSessionFileExport,
} from './codex-transcript-renderer';

const tempPaths: string[] = [];

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const writeHeadroomReplacementArchive = async (
    archiveDir: string,
    replacement: { client: string; originalText: string; rewrittenText: string; sessionId: string },
) => {
    await mkdir(archiveDir, { recursive: true });
    await Bun.write(
        path.join(archiveDir, '2026-07-06.jsonl'),
        `${JSON.stringify({
            archive_id: 'codex-replacement',
            client: replacement.client,
            endpoint: '/v1/responses',
            event_type: 'replacement',
            model: null,
            original_text: replacement.originalText,
            original_text_sha256: sha256(replacement.originalText),
            path: '$."input"[0]."content"',
            provider: null,
            request_id: null,
            rewritten_text: replacement.rewrittenText,
            rewritten_text_sha256: sha256(replacement.rewrittenText),
            schema_version: 1,
            session_id: replacement.sessionId,
            timestamp: '2026-07-06T12:00:00+0000',
            timestamp_unix: 1_783_340_800,
            tokens_saved: 18,
            transforms: ['markdown'],
            transport: 'http',
        })}\n`,
    );
};

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('codex transcript renderer helpers', () => {
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

    it('should rehydrate Headroom-compressed Codex markdown during export', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-headroom-rehydration-test-'));
        tempPaths.push(tempRoot);
        const fixture = await createCodexFixture(tempRoot);
        const archiveDir = path.join(tempRoot, 'headroom');
        const compressedText = 'Original request: inspect files; run tests.';
        const originalMarkdown = '# Original request\n\n- inspect files\n- run tests';

        await writeHeadroomReplacementArchive(archiveDir, {
            client: 'codex_cli_rs',
            originalText: originalMarkdown,
            rewrittenText: compressedText,
            sessionId: fixture.threadId,
        });
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
                        message: compressedText,
                        type: 'user_message',
                    },
                    type: 'response_item',
                }),
            ].join('\n'),
        );

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
                archiveDir,
                includeCommentary: true,
                includeMetadata: true,
                includeTools: false,
                outputFormat: 'md',
            },
        );

        expect(content).toContain(originalMarkdown);
        expect(content).not.toContain(compressedText);
        expect(content).toContain('headroom_rehydrated: true');
    });

    it('should omit hidden messages, unsupported tools, and commentary when exporting a rich transcript', async () => {
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
        expect(content).not.toContain('Hidden commentary');
        expect(content).not.toContain('search_repo');
        expect(content).not.toContain('unstructured output');
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
