import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    type ClaudeCliOptions,
    DEFAULT_OUTPUT_DIR,
    getClaudeHelpText,
    parseClaudeCliArgs,
    runClaudeExport,
} from './claude-exporter';
import { CliUsageError } from './shared';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('runClaudeExport', () => {
    it('should parse cli options from flags and positional arguments', () => {
        expect(
            parseClaudeCliArgs([
                '--input',
                '~/session.jsonl',
                '--output',
                '~/exports',
                '--output-format',
                'txt',
                '--tools',
            ]),
        ).toEqual({
            includeTools: true,
            inputPath: path.join(os.homedir(), 'session.jsonl'),
            outputFormat: 'txt',
            outputPath: path.join(os.homedir(), 'exports'),
        });

        expect(parseClaudeCliArgs(['/tmp/input.jsonl', '/tmp/output-dir'])).toEqual({
            includeTools: false,
            inputPath: '/tmp/input.jsonl',
            outputFormat: 'md',
            outputPath: '/tmp/output-dir',
        });
    });

    it('should reject invalid Claude cli arguments', () => {
        expect(() => parseClaudeCliArgs([])).toThrow(CliUsageError);
        expect(() => parseClaudeCliArgs(['--input'])).toThrow('Missing value for --input');
        expect(() => parseClaudeCliArgs(['--output-format', 'pdf'])).toThrow('Unsupported output format: pdf');
        expect(() => parseClaudeCliArgs(['--wat'])).toThrow('Unknown argument: --wat');
        expect(getClaudeHelpText()).toContain(DEFAULT_OUTPUT_DIR);
    });

    it('exports a Claude directory input as actual plain text', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-export-test-'));
        tempPaths.push(tempRoot);

        const inputDir = path.join(tempRoot, 'claude-session');
        const outputDir = path.join(tempRoot, 'exports');
        const cliSessionId = '0c73ac79-550a-4b2d-b58d-542a2974405a';

        await mkdir(inputDir, { recursive: true });
        await Bun.write(
            path.join(inputDir, 'metadata.json'),
            JSON.stringify({
                cliSessionId,
                completedTurns: 3,
                createdAt: 1776557630627,
                cwd: '/tmp/ushman',
                effort: 'max',
                isArchived: false,
                lastActivityAt: 1776696034435,
                model: 'claude-opus-4-7',
                title: 'Claude Export Test',
            }),
        );
        await Bun.write(
            path.join(inputDir, `${cliSessionId}.jsonl`),
            [
                JSON.stringify({
                    message: {
                        content: 'Export this transcript',
                        role: 'user',
                    },
                    sessionId: cliSessionId,
                    timestamp: '2026-04-19T20:59:15.313Z',
                    type: 'user',
                }),
                JSON.stringify({
                    message: {
                        content: [
                            { text: 'Running a shell command.', type: 'text' },
                            {
                                id: 'toolu_1',
                                input: {
                                    command: 'ls',
                                    description: 'List files',
                                },
                                name: 'Bash',
                                type: 'tool_use',
                            },
                        ],
                        role: 'assistant',
                    },
                    sessionId: cliSessionId,
                    timestamp: '2026-04-19T21:00:00.000Z',
                    type: 'assistant',
                }),
                JSON.stringify({
                    message: {
                        content: [
                            {
                                content: 'file-a\nfile-b',
                                is_error: false,
                                tool_use_id: 'toolu_1',
                                type: 'tool_result',
                            },
                        ],
                        role: 'user',
                    },
                    sessionId: cliSessionId,
                    timestamp: '2026-04-19T21:00:01.000Z',
                    type: 'user',
                }),
            ].join('\n'),
        );

        const result = await runClaudeExport({
            includeTools: true,
            inputPath: inputDir,
            outputFormat: 'txt',
            outputPath: outputDir,
        } satisfies ClaudeCliOptions);

        const exported = await Bun.file(result.outputPath).text();
        expect(exported).toContain('Claude Export Test');
        expect(exported).toContain('Metadata');
        expect(exported).toContain('is_archived: false');
        expect(exported).toContain('User\n----\nExport this transcript');
        expect(exported).toContain('Assistant\n---------\nRunning a shell command.');
        expect(exported).toContain('Tool\n----\nCommand: ls');
        expect(exported).toContain('Tool Output\n-----------\nfile-a\nfile-b');
        expect(exported).not.toContain('## Tool');
        expect(exported).not.toContain('```');
    });

    it('should export a raw Claude jsonl file without metadata using the first user message as the title', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-export-file-test-'));
        tempPaths.push(tempRoot);
        const jsonlPath = path.join(tempRoot, 'session.jsonl');

        await Bun.write(
            jsonlPath,
            [
                JSON.stringify({
                    message: {
                        content: [{ text: 'Summarize this transcript', type: 'text' }],
                        role: 'user',
                    },
                    sessionId: 'session-1',
                    timestamp: '2026-04-19T20:59:15.313Z',
                    type: 'user',
                }),
                JSON.stringify({
                    gitBranch: 'main',
                    message: {
                        content: [
                            { text: 'Here is the summary.', type: 'output_text' },
                            { text: 'Internal thought', type: 'thinking' },
                            { text: 'Fallback plain text', type: 'unknown' },
                        ],
                        model: 'claude-sonnet-4',
                        role: 'assistant',
                    },
                    sessionId: 'session-1',
                    timestamp: '2026-04-19T21:00:00.000Z',
                    type: 'assistant',
                    version: '1.2.3',
                }),
            ].join('\n'),
        );

        const result = await runClaudeExport({
            includeTools: false,
            inputPath: jsonlPath,
            outputFormat: 'md',
            outputPath: null,
        });

        const exported = await Bun.file(result.outputPath).text();
        expect(path.basename(result.outputPath)).toBe('session.md');
        expect(exported).toContain('# Summarize this transcript');
        expect(exported).toContain('model: "claude-sonnet-4"');
        expect(exported).toContain('git_branch: "main"');
        expect(exported).toContain('## Assistant');
        expect(exported).toContain('Fallback plain text');
        expect(exported).not.toContain('Tool Output');
    });

    it('should resolve metadata-selected jsonl files and directory output targets', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-export-dir-test-'));
        tempPaths.push(tempRoot);
        const inputDir = path.join(tempRoot, 'session');
        const outputDir = path.join(tempRoot, 'exports');
        const cliSessionId = 'session-picked';

        await mkdir(inputDir, { recursive: true });
        await mkdir(outputDir, { recursive: true });
        await Bun.write(
            path.join(inputDir, 'metadata.json'),
            JSON.stringify({
                cliSessionId,
                title: 'Picked Session',
            }),
        );
        await Bun.write(
            path.join(inputDir, `${cliSessionId}.jsonl`),
            JSON.stringify({
                message: {
                    content: 'Hello from picked session',
                    role: 'user',
                },
                sessionId: cliSessionId,
                type: 'user',
            }),
        );
        await Bun.write(
            path.join(inputDir, 'other.jsonl'),
            JSON.stringify({
                message: {
                    content: 'Other session',
                    role: 'user',
                },
                sessionId: 'other',
                type: 'user',
            }),
        );

        const result = await runClaudeExport({
            includeTools: false,
            inputPath: inputDir,
            outputFormat: 'md',
            outputPath: outputDir,
        });

        expect(result.outputPath).toBe(path.join(outputDir, `${cliSessionId}.md`));
        expect(await Bun.file(result.outputPath).text()).toContain('Picked Session');
    });

    it('should reject ambiguous or empty Claude directories', async () => {
        const ambiguousRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-export-ambiguous-test-'));
        const emptyRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-export-empty-test-'));
        tempPaths.push(ambiguousRoot, emptyRoot);

        await Bun.write(path.join(ambiguousRoot, 'a.jsonl'), '');
        await Bun.write(path.join(ambiguousRoot, 'b.jsonl'), '');

        await expect(
            runClaudeExport({
                includeTools: false,
                inputPath: ambiguousRoot,
                outputFormat: 'md',
                outputPath: null,
            }),
        ).rejects.toThrow('Multiple top-level .jsonl files found');

        await expect(
            runClaudeExport({
                includeTools: false,
                inputPath: emptyRoot,
                outputFormat: 'md',
                outputPath: null,
            }),
        ).rejects.toThrow('No top-level Claude transcript .jsonl found');
    });

    it('should throw when a transcript has no exportable Claude content', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-export-empty-content-test-'));
        tempPaths.push(tempRoot);
        const jsonlPath = path.join(tempRoot, 'session.jsonl');

        await Bun.write(
            jsonlPath,
            JSON.stringify({
                isCompactSummary: true,
                type: 'summary',
            }),
        );

        await expect(
            runClaudeExport({
                includeTools: false,
                inputPath: jsonlPath,
                outputFormat: 'md',
                outputPath: null,
            }),
        ).rejects.toThrow(`No transcript content found in ${jsonlPath}`);
    });
});
