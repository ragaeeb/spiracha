import { describe, expect, it } from 'bun:test';
import {
    buildBatchExportBaseName,
    getExportMimeType,
    resolveUniqueExportFileBaseName,
    sanitizeExportFileName,
} from './ui-export-archive';

describe('ui export archive helpers', () => {
    it('should sanitize export filenames consistently', () => {
        expect(sanitizeExportFileName('bad<>:"/\\|?*\u0000 name..md')).toBe('bad name md');
        expect(sanitizeExportFileName('   ')).toBe('');
    });

    it('should resolve filename collisions with per-base counters', () => {
        const used = new Map<string, number>();

        expect(resolveUniqueExportFileBaseName('same', used)).toBe('same');
        expect(resolveUniqueExportFileBaseName('other', used)).toBe('other');
        expect(resolveUniqueExportFileBaseName('same', used)).toBe('same-2');
        expect(resolveUniqueExportFileBaseName('same', used)).toBe('same-3');
    });

    it('should name batch archives from the project, latest conversation time, and selected thread count', () => {
        expect(
            buildBatchExportBaseName(
                [
                    {
                        cwd: '/Users/example/workspace/spiracha',
                        updatedAtMs: Date.UTC(2026, 4, 17, 17, 11),
                    },
                    {
                        cwd: '/Users/example/workspace/spiracha',
                        updatedAtMs: Date.UTC(2026, 4, 17, 17, 12),
                    },
                ],
                'threads',
            ),
        ).toBe('spiracha-2026-05-17-1712-threads-2');

        expect(
            buildBatchExportBaseName(
                [
                    {
                        cwd: 'C:\\workspace\\spiracha',
                        updatedAtMs: Date.UTC(2026, 4, 17, 17, 12),
                    },
                ],
                'threads',
            ),
        ).toBe('spiracha-2026-05-17-1712-threads-1');
    });

    it('should return text MIME types for export formats', () => {
        expect(getExportMimeType('md')).toBe('text/markdown; charset=utf-8');
        expect(getExportMimeType('txt')).toBe('text/plain; charset=utf-8');
    });
});
