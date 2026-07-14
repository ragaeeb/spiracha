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
    getPortablePathBasename,
    inlineCode,
    readJsonlObjects,
    renderCodeBlock,
    renderDocumentTitle,
    renderMetadataBlock,
    renderSection,
    writeExportFile,
} from './shared';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('shared helpers', () => {
    it('should normalize home paths and portable basenames', () => {
        expect(expandHome('')).toBe('');
        expect(expandHome('~')).toBe(os.homedir());
        expect(expandHome('~/workspace/spiracha')).toBe(path.join(os.homedir(), 'workspace/spiracha'));
        expect(getPortablePathBasename('/tmp/summer/')).toBe('summer');
        expect(getPortablePathBasename('C:\\Users\\user\\workspace\\summer\\')).toBe('summer');
    });

    it('should clean titles and extracted transcript text', () => {
        expect(cleanInlineTitle('\n  First line  \nSecond line')).toBe('First line');
        expect(cleanInlineTitle(`\n${'x'.repeat(180)}`)).toBe(`${'x'.repeat(157)}...`);
        expect(cleanExtractedText('<image>\n\nhello\n\n\nworld\n</image>\n')).toBe('\nhello\n\nworld\n');
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

    it('should skip invalid jsonl lines and write export files to disk', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'shared-test-'));
        tempPaths.push(tempRoot);
        const jsonlPath = path.join(tempRoot, 'session.jsonl');
        await Bun.write(jsonlPath, [' ', '{oops', '{"type":"message"}', '{"type":"tool"}'].join('\n'));

        const entries: Array<Record<string, unknown>> = [];
        for await (const entry of readJsonlObjects(jsonlPath)) {
            entries.push(entry);
        }

        expect(entries).toEqual([{ type: 'message' }, { type: 'tool' }]);

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
