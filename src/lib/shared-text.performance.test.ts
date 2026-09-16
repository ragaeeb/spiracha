import { expect, it, spyOn } from 'bun:test';
import { cleanInlineTitle } from './shared-text';

it('should stop extracting a title at the first nonempty line', () => {
    const input = ` \r\n\t\n  A\t title  \r\n${'irrelevant body\n'.repeat(50_000)}`;
    const split = spyOn(String.prototype, 'split');
    try {
        expect(cleanInlineTitle(input)).toBe('A title');
        expect(split).not.toHaveBeenCalled();
    } finally {
        split.mockRestore();
    }
});

it('should preserve blank, CRLF, Unicode whitespace, and long-title behavior', () => {
    for (const input of ['', '\n\t \r\n', '\n\u2003One\u2003two\r\nignored', 'x'.repeat(500), 'one\rtwo']) {
        const firstLine =
            input
                .split('\n')
                .map((line) => line.trim())
                .find(Boolean) ?? '';
        const compact = firstLine.replace(/\s+/g, ' ').trim();
        const expected = compact.length <= 160 ? compact : `${compact.slice(0, 157).trimEnd()}...`;
        expect(cleanInlineTitle(input)).toBe(expected);
    }
});
