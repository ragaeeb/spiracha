import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    asBoolean,
    asNumber,
    asObject,
    asString,
    cleanExtractedText,
    cleanInlineTitle,
    createExportWriteStream,
    expandHome,
    finalizeExportWriteStream,
    formatInlineLiteral,
    formatModelLabel,
    inlineCode,
    pathExists,
    readDirectoryEntriesIfExists,
    readJsonlObjects,
    renderCodeBlock,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
    toFileUri,
    writeExportFile,
} from './shared';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('shared helpers', () => {
    it('should normalize home paths', () => {
        expect(expandHome('')).toBe('');
        expect(expandHome('~')).toBe(os.homedir());
        expect(expandHome('~/workspace/spiracha')).toBe(path.join(os.homedir(), 'workspace/spiracha'));
        expect(expandHome('~\\workspace\\spiracha')).toBe(path.join(os.homedir(), 'workspace', 'spiracha'));
    });

    it('should ignore only missing directories while listing entries', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'shared-directory-test-'));
        tempPaths.push(root);
        const filePath = path.join(root, 'file.txt');
        await Bun.write(filePath, 'content');

        await expect(readDirectoryEntriesIfExists(path.join(root, 'missing'))).resolves.toEqual([]);
        await expect(readDirectoryEntriesIfExists(filePath)).rejects.toMatchObject({ code: 'ENOTDIR' });
    });

    it('should percent-encode filesystem paths in file URIs', () => {
        expect(toFileUri('/tmp/project #1')).toBe('file:///tmp/project%20%231');
    });

    it('should clean titles and extracted transcript text', () => {
        expect(cleanInlineTitle('\n  First line  \nSecond line')).toBe('First line');
        expect(cleanInlineTitle(`\n${'x'.repeat(180)}`)).toBe(`${'x'.repeat(157)}...`);
        expect(cleanExtractedText('<image>\n\nhello\n\n\nworld\n</image>\n')).toBe('\nhello\n\nworld\n');
    });

    it('should detect existing files and directories', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'shared-path-exists-'));
        tempPaths.push(tempDir);

        expect(await pathExists(tempDir)).toBe(true);
        expect(await pathExists(path.join(tempDir, 'missing'))).toBe(false);
    });

    it('should format model labels and inline code safely', () => {
        expect(formatModelLabel(null)).toBe('Assistant');
        expect(formatModelLabel('gpt-5.4')).toBe('GPT 5.4');
        expect(formatModelLabel('claude-opus-4-8')).toBe('Claude Opus 4.8');
        expect(formatModelLabel('claude-3-5-sonnet-20241022')).toBe('Claude 3.5 Sonnet 20241022');
        expect(formatModelLabel('o3')).toBe('O3');
        expect(formatModelLabel('custom_model')).toBe('Custom Model');
        expect(inlineCode('`wrapped`')).toBe('`` `wrapped` ``');
        expect(formatInlineLiteral('bun test', 'md')).toBe('`bun test`');
        expect(formatInlineLiteral('bun test', 'txt')).toBe('bun test');
    });

    it('should coerce typed JSON helpers safely', () => {
        expect(asObject({ hello: 'world' })).toEqual({ hello: 'world' });
        expect(asObject(['nope'])).toBeNull();
        expect(asString('hello')).toBe('hello');
        expect(asString(12)).toBeNull();
        expect(asNumber(12)).toBe(12);
        expect(asNumber('12')).toBeNull();
        expect(asBoolean(true)).toBe(true);
        expect(asBoolean(false)).toBe(false);
    });

    it('should render document sections and metadata in markdown and text formats', () => {
        expect(renderDocumentTitle('Example', 'md')).toBe('# Example');
        expect(renderDocumentTitle('Example', 'txt')).toBe('Example\n=======');
        expect(renderCodeBlock('echo hi', 'md')).toBe('```text\necho hi\n```');
        expect(renderCodeBlock('echo hi', 'txt')).toBe('echo hi');
        expect(renderSection('User', 'hello', 'md')).toBe('## User\n\nhello\n');
        expect(renderSection('User', 'hello', 'txt')).toBe('User\n----\nhello\n');
        expect(renderSection('User', '', 'md')).toBe('');
        expect(
            renderMetadataBlock(
                [
                    { key: 'name', value: 'spiracha' },
                    { key: 'empty', value: '' },
                    { key: 'count', value: 3 },
                    { key: 'json', value: { ok: true } },
                ],
                'md',
            ),
        ).toBe(['---', 'name: "spiracha"', 'count: 3', 'json: {"ok":true}', '---', ''].join('\n'));
        expect(renderMetadataBlock([{ key: 'name', value: 'spiracha' }], 'txt')).toBe(
            'Metadata\n--------\nname: spiracha\n',
        );
    });

    it('should keep markdown code blocks valid when exported content contains backtick fences', () => {
        expect(renderCodeBlock('before\n```ts\nconst value = 1;\n```\nafter', 'md')).toBe(
            '````text\nbefore\n```ts\nconst value = 1;\n```\nafter\n````',
        );
        expect(renderCodeBlock('before\n```\nafter', 'txt')).toBe('before\n```\nafter');
    });

    it('should warn about skipped invalid jsonl lines and write export files to disk', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'shared-test-'));
        tempPaths.push(tempRoot);
        const jsonlPath = path.join(tempRoot, 'session.jsonl');
        await Bun.write(jsonlPath, [' ', '{oops', 'null', '{"type":"message"}', '{"type":"tool"}'].join('\n'));

        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args) => warnings.push(args);
        const entries: Array<Record<string, unknown>> = [];
        try {
            for await (const entry of readJsonlObjects(jsonlPath)) {
                entries.push(entry);
            }
        } finally {
            console.warn = originalWarn;
        }

        expect(entries).toEqual([{ type: 'message' }, { type: 'tool' }]);
        expect(warnings).toEqual([
            ['[spiracha:jsonl] invalid_json_line', { filePath: jsonlPath, lineNumber: 2 }],
            ['[spiracha:jsonl] invalid_json_line', { filePath: jsonlPath, lineNumber: 3 }],
        ]);

        const outputPath = path.join(tempRoot, 'exports', 'thread.txt');
        await writeExportFile(outputPath, 'hello world');
        expect(await Bun.file(outputPath).text()).toBe('hello world');

        const streamPath = path.join(tempRoot, 'exports', 'stream.txt');
        const stream = await createExportWriteStream(streamPath);
        stream.write('streamed');
        await finalizeExportWriteStream(stream);
        expect(await Bun.file(streamPath).text()).toBe('streamed');
    });
});
