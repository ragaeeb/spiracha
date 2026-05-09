import { describe, expect, it } from 'bun:test';
import {
    getCodexHelpText,
    parseCodexCliArgs,
    parseThreadSelectionArg,
    resolveDefaultOutputDir,
} from './codex-exporter';

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

    it('extracts thread ids from codex deeplinks only', () => {
        expect(parseThreadSelectionArg('codex://threads/abc-123')).toBe('abc-123');
        expect(parseThreadSelectionArg(' https://example.com ')).toBeNull();
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
});
