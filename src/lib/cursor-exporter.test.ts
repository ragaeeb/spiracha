import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCursorHelpText, parseCursorCliArgs, runCursorExport } from './cursor-exporter';
import { getDefaultCursorUserDir, resolveCursorUserDir } from './cursor-exporter-types';
import { type CursorFixtureSpec, createCursorFixture } from './cursor-test-helpers';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const makeUserDir = async (): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cursor-export-'));
    tempDirs.push(dir);
    return dir;
};

const spec = (): CursorFixtureSpec => ({
    buckets: [
        {
            bucketId: 'bucket-old',
            composerIds: ['thread-1'],
            folder: 'file:///Users/test/workspace/demo',
            threadsInComposerData: true,
        },
    ],
    headerLinks: [{ bucketId: 'bucket-old', composerId: 'thread-1' }],
    threads: [
        {
            bubbles: [
                { bubbleId: 'b1', text: 'Fix the bug', type: 1 },
                {
                    bubbleId: 'b2',
                    text: 'Done',
                    thinking: 'inspect first',
                    toolCall: { name: 'read_file', rawArgs: '{"path":"a"}', result: 'contents' },
                    type: 2,
                },
            ],
            composerId: 'thread-1',
            lastUpdatedAt: 5,
            name: 'Demo thread',
        },
    ],
});

describe('parseCursorCliArgs', () => {
    it('should default to markdown with metadata and a positional workspace', () => {
        const options = parseCursorCliArgs(['gun-twizzle']);
        expect(options.workspaceQuery).toBe('gun-twizzle');
        expect(options.outputFormat).toBe('md');
        expect(options.includeMetadata).toBe(true);
        expect(options.includeTools).toBe(false);
    });

    it('should parse tool, commentary, format, and thread flags', () => {
        const options = parseCursorCliArgs([
            '--thread',
            'abc',
            '--thread',
            'def',
            '--tools',
            '--commentary',
            '--output-format',
            'txt',
        ]);
        expect(options.threadIds).toEqual(['abc', 'def']);
        expect(options.includeTools).toBe(true);
        expect(options.includeCommentary).toBe(true);
        expect(options.outputFormat).toBe('txt');
    });
});

describe('runCursorExport', () => {
    it('should export a workspace thread to a markdown file', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, spec());
        const outputDir = path.join(userDir, 'out');

        const result = await runCursorExport({
            includeCommentary: true,
            includeMetadata: true,
            includeTools: true,
            outputDir,
            outputFormat: 'md',
            threadIds: [],
            userDir,
            workspaceQuery: 'demo',
        });

        expect(result.exportedCount).toBe(1);
        const files = await readdir(outputDir);
        expect(files).toContain('thread-1.md');
        const content = await Bun.file(path.join(outputDir, 'thread-1.md')).text();
        expect(content).toContain('Fix the bug');
        expect(content).toContain('Tool Call');
    });

    it('should report missing thread ids that cannot be found', async () => {
        const userDir = await makeUserDir();
        await createCursorFixture(userDir, spec());

        const result = await runCursorExport({
            includeCommentary: false,
            includeMetadata: true,
            includeTools: false,
            outputDir: path.join(userDir, 'out'),
            outputFormat: 'md',
            threadIds: ['does-not-exist'],
            userDir,
            workspaceQuery: null,
        });

        expect(result.exportedCount).toBe(0);
        expect(result.missingThreadIds).toContain('does-not-exist');
    });
});

describe('getCursorHelpText', () => {
    it('should document the export, recover, and prune subcommands', () => {
        const help = getCursorHelpText();
        expect(help).toContain('spiracha cursor list');
        expect(help).toContain('spiracha cursor export');
        expect(help).toContain('spiracha cursor recover');
        expect(help).toContain('spiracha cursor prune');
    });
});

describe('resolveCursorUserDir', () => {
    it('should compute platform-specific default Cursor user directories', () => {
        expect(getDefaultCursorUserDir('darwin', {}, '/Users/alice')).toBe(
            '/Users/alice/Library/Application Support/Cursor/User',
        );
        expect(
            getDefaultCursorUserDir('win32', { APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming' }, 'C:\\Users\\Alice'),
        ).toBe('C:\\Users\\Alice\\AppData\\Roaming\\Cursor\\User');
        expect(getDefaultCursorUserDir('linux', { XDG_DATA_HOME: '/home/alice/.local/state' }, '/home/alice')).toBe(
            '/home/alice/.local/state/Cursor/User',
        );
    });

    it('should honor the SPIRACHA_CURSOR_USER_DIR override', () => {
        const previous = process.env.SPIRACHA_CURSOR_USER_DIR;
        process.env.SPIRACHA_CURSOR_USER_DIR = '/tmp/custom-cursor';
        try {
            expect(resolveCursorUserDir()).toBe('/tmp/custom-cursor');
        } finally {
            if (previous === undefined) {
                delete process.env.SPIRACHA_CURSOR_USER_DIR;
            } else {
                process.env.SPIRACHA_CURSOR_USER_DIR = previous;
            }
        }
    });
});
