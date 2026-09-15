import { describe, expect, it } from 'bun:test';
import { sanitizeExportFileName } from './ui-export-archive';

describe('portable export names', () => {
    it('should escape Windows device names even with extensions or superscript device numbers', () => {
        for (const name of ['CON', 'prn', 'AUX', 'NUL.tar', 'COM1', 'lpt9.log', 'COM¹', 'LPT²', 'COM³.txt']) {
            expect(sanitizeExportFileName(name)).toBe(`_${name}`);
        }
    });

    it('should strip trailing Windows-ignored punctuation before checking device names', () => {
        expect(sanitizeExportFileName('NUL. ')).toBe('_NUL');
        expect(sanitizeExportFileName('notes. ')).toBe('notes');
        expect(sanitizeExportFileName('.')).toBe('');
    });

    it('should leave ordinary names and non-reserved device-like prefixes unchanged', () => {
        for (const name of ['conversation', 'COM10', 'LPT10', 'CON-review', '.hidden']) {
            expect(sanitizeExportFileName(name)).toBe(name);
        }
    });
});
