import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type ClaudeCliOptions, runClaudeExport } from './claude-exporter';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('runClaudeExport', () => {
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
});
