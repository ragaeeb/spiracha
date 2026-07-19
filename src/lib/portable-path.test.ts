import { describe, expect, it } from 'bun:test';
import { getPortablePathBasename } from './portable-path';

describe('portable path helpers', () => {
    it('should resolve POSIX and Windows basenames without platform-specific imports', () => {
        expect(getPortablePathBasename('/tmp/summer/')).toBe('summer');
        expect(getPortablePathBasename('C:\\Users\\user\\workspace\\summer\\')).toBe('summer');
        expect(getPortablePathBasename('')).toBe('');
    });
});
