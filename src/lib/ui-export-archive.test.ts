import { describe, expect, it } from 'bun:test';
import { getExportMimeType, resolveUniqueExportFileBaseName, sanitizeExportFileName } from './ui-export-archive';

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

    it('should return text MIME types for export formats', () => {
        expect(getExportMimeType('md')).toBe('text/markdown; charset=utf-8');
        expect(getExportMimeType('txt')).toBe('text/plain; charset=utf-8');
    });
});
