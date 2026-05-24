import { describe, expect, it } from 'bun:test';
import {
    type CodexCliOptions,
    DEFAULT_DB_PATH,
    DEFAULT_INPUT_DIR,
    DEFAULT_OUTPUT_DIR,
    getCodexHelpText,
    parseCodexCliArgs,
    parseThreadSelectionArg,
    resolveDefaultOutputDir,
} from './codex-exporter';
import { CliUsageError } from './shared';

describe('codex exporter cli', () => {
    it('parses scoped arguments and deduplicates deeplinks', () => {
        const options = parseCodexCliArgs([
            '--project',
            'summer',
            '--tools',
            '--output-format',
            'txt',
            '--flat',
            'codex://threads/a',
            'codex://threads/a',
            'codex://threads/b',
        ]);

        expect(options.projectFilter).toBe('summer');
        expect(options.includeTools).toBe(true);
        expect(options.outputFormat).toBe('txt');
        expect(options.flat).toBe(true);
        expect(options.threadIds).toEqual(['a', 'b']);
    });

    it('should parse defaults and preserve commentary in the cli path', () => {
        const options = parseCodexCliArgs([]);

        expect(options).toEqual({
            cwdFilter: null,
            dbPath: DEFAULT_DB_PATH,
            flat: false,
            includeCommentary: true,
            includeTools: false,
            inputDir: DEFAULT_INPUT_DIR,
            optimized: false,
            outputDir: DEFAULT_OUTPUT_DIR,
            outputFormat: 'md',
            projectFilter: null,
            threadIds: [],
        } satisfies CodexCliOptions);
    });

    it('should expand filesystem paths for db input output and cwd flags', () => {
        const options = parseCodexCliArgs([
            '--db',
            '~/.codex/db.sqlite',
            '--input',
            '~/sessions',
            '--output',
            '~/exports',
            '--cwd',
            '~/workspace/spiracha',
        ]);

        expect(options.dbPath.includes('.codex/db.sqlite')).toBe(true);
        expect(options.inputDir.includes('/sessions')).toBe(true);
        expect(options.outputDir.includes('/exports')).toBe(true);
        expect(options.cwdFilter?.includes('/workspace/spiracha')).toBe(true);
    });

    it('extracts thread ids from codex deeplinks only', () => {
        expect(parseThreadSelectionArg('codex://threads/abc-123')).toBe('abc-123');
        expect(parseThreadSelectionArg(' codex://threads/abc-123 ')).toBe('abc-123');
        expect(parseThreadSelectionArg(' https://example.com ')).toBeNull();
        expect(parseThreadSelectionArg('codex://threads/abc-123?with=query')).toBeNull();
        expect(parseThreadSelectionArg('')).toBeNull();
    });

    it('describes project and deeplink filters in help text', () => {
        const help = getCodexHelpText();
        expect(help).toContain('--project');
        expect(help).toContain('codex://threads/<id>');
        expect(help).toContain('--interactive');
    });

    it('matches cwd-based default output behavior', () => {
        const outputDir = resolveDefaultOutputDir('/tmp/summer');
        expect(outputDir.endsWith('/summer')).toBe(true);
    });

    it('matches cwd-based default output behavior for Windows-style paths', () => {
        const outputDir = resolveDefaultOutputDir('C:\\Users\\user\\workspace\\summer');
        expect(outputDir.endsWith('/summer')).toBe(true);
    });

    it('should support inline output format flags', () => {
        const options = parseCodexCliArgs(['--output-format=txt']);
        expect(options.outputFormat).toBe('txt');
    });

    it('should reject unsupported positional arguments and bad flag usage', () => {
        expect(() => parseCodexCliArgs(['README.md'])).toThrow(CliUsageError);
        expect(() => parseCodexCliArgs(['--db'])).toThrow('Missing value for --db');
        expect(() => parseCodexCliArgs(['--project', '--tools'])).toThrow('Missing value for --project');
        expect(() => parseCodexCliArgs(['--output-format', 'pdf'])).toThrow('Unsupported output format: pdf');
        expect(() => parseCodexCliArgs(['--wat'])).toThrow('Unknown argument: --wat');
    });
});
