import { describe, expect, it } from 'bun:test';
import { assertCoverageThreshold, summarizeLcovReport } from './coverage-check';

const report = (counts: string[], filePath = 'src/lib/example.ts') =>
    [`SF:${filePath}`, ...counts, 'end_of_record'].join('\n');

describe('coverage report integrity', () => {
    it.each(['', 'no tests were executed', 'TN:empty\nend_of_record'])(
        'should reject an empty or non-measurable report: %s',
        (text) => {
            expect(() => summarizeLcovReport('root', text)).toThrow();
        },
    );

    it.each(
        [
            ['LF:10', 'LH:NaN'],
            ['LF:10', 'LH:Infinity'],
            ['LF:10', 'LH:-1'],
            ['LF:10', 'LH:1.5'],
            ['LF:10', 'LH:11'],
            ['LF:10'],
            ['LH:10'],
            ['LF:10', 'LH:10', 'LH:0'],
            ['LF:9007199254740992', 'LH:1'],
            ['LF:10', 'LH:10', 'FNF:1'],
            ['LF:10', 'LH:10', 'FNF:1', 'FNH:2'],
        ].map((counts) => [counts]),
    )('should reject malformed or impossible LCOV counts: %j', (counts) => {
        expect(() => summarizeLcovReport('root', report(counts))).toThrow(/LCOV/u);
    });

    it('should reject a truncated final record', () => {
        expect(() => summarizeLcovReport('root', 'SF:src/lib/example.ts\nLF:10\nLH:10')).toThrow(/LCOV/u);
    });

    it('should reject duplicate source records instead of weighting their coverage twice', () => {
        const block = report(['LF:10', 'LH:10']);
        expect(() => summarizeLcovReport('root', `${block}\n${block}`)).toThrow(/Duplicate/u);
    });

    it('should reject reports containing only excluded files', () => {
        expect(() => summarizeLcovReport('ui', report(['LF:10', 'LH:10'], 'src/ui/components/ui/dialog.tsx'))).toThrow(
            /measurable/u,
        );
    });

    it('should apply UI exclusions to Windows paths as well as POSIX paths', () => {
        const summary = summarizeLcovReport(
            'ui',
            [
                report(['LF:10', 'LH:9'], 'C:\\repo\\src\\ui\\components\\theme-toggle.tsx'),
                report(['LF:100', 'LH:0'], 'C:\\repo\\src\\ui\\components\\ui\\dialog.tsx'),
            ].join('\n'),
        );
        expect(summary.fileSummaries).toHaveLength(1);
        expect(summary.lineCoverage).toBe(90);
    });

    it('should allow a measurable line-only report without function counters', () => {
        const summary = summarizeLcovReport('root', report(['LF:10', 'LH:9']));
        expect(summary.functionTotal).toBe(0);
        expect(summary.lineCoverage).toBe(90);
        expect(() => assertCoverageThreshold(summary)).not.toThrow();
    });

    it('should reject zero executable lines even when files are present', () => {
        expect(() => summarizeLcovReport('root', report(['LF:0', 'LH:0']))).toThrow(/measurable/u);
    });

    it('should enforce the unrounded ratio rather than accepting 89.999 percent as 90 percent', () => {
        const summary = summarizeLcovReport('root', report(['LF:100000', 'LH:89999']));
        expect(summary.lineCoverage).toBe(90);
        expect(() => assertCoverageThreshold(summary)).toThrow(/below/u);
    });

    it('should accept the exact 90 percent boundary and reject one fewer covered line', () => {
        expect(() => assertCoverageThreshold(summarizeLcovReport('root', report(['LF:10', 'LH:9'])))).not.toThrow();
        expect(() => assertCoverageThreshold(summarizeLcovReport('root', report(['LF:10', 'LH:8'])))).toThrow();
    });
});
