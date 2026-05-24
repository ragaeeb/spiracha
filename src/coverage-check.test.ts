import { describe, expect, it } from 'bun:test';
import { summarizeLcovReport } from './coverage-check';

describe('coverage check helpers', () => {
    it('should summarize lcov reports with profile-specific exclusions', () => {
        const summary = summarizeLcovReport(
            'ui',
            [
                'SF:src/components/theme-toggle.tsx',
                'FNF:2',
                'FNH:2',
                'LF:10',
                'LH:9',
                'end_of_record',
                'SF:src/components/ui/dialog.tsx',
                'FNF:10',
                'FNH:0',
                'LF:20',
                'LH:0',
                'end_of_record',
            ].join('\n'),
        );

        expect(summary.lineCoverage).toBe(90);
        expect(summary.functionCoverage).toBe(100);
        expect(summary.fileSummaries).toHaveLength(1);
        expect(summary.fileSummaries[0]?.filePath).toBe('src/components/theme-toggle.tsx');
    });
});
