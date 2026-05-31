import { describe, expect, it } from 'vitest';
import { matchesTextQuery } from './text-filter';

describe('matchesTextQuery', () => {
    it('should treat an empty query as a match', () => {
        expect(matchesTextQuery('', ['Cursor workspace', 'agent mode'])).toBe(true);
    });

    it('should match case-insensitively across multiple fields', () => {
        expect(matchesTextQuery('cursor agent', ['Demo workspace', 'Agent mode', 'Cursor'])).toBe(true);
    });

    it('should require every search term to be present somewhere in the row fields', () => {
        expect(matchesTextQuery('cursor missing', ['Cursor workspace', 'Agent mode'])).toBe(false);
    });

    it('should ignore nullish values and still match booleans and numbers', () => {
        expect(matchesTextQuery('false 42', [null, undefined, false, 42])).toBe(true);
    });

    it('should treat whitespace-only queries as a match', () => {
        expect(matchesTextQuery('   \n\t  ', ['Cursor workspace'])).toBe(true);
    });

    it('should preserve special characters in search tokens', () => {
        expect(matchesTextQuery('folder:/tmp/demo gpt-5.4', ['folder:/tmp/demo', 'gpt-5.4'])).toBe(true);
    });
});
