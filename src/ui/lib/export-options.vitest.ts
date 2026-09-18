import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoredZipPassword, storeZipPassword } from './export-options';

afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('ZIP password storage', () => {
    it('should remember and clear the password without changing whitespace', () => {
        storeZipPassword('  reusable password  ');
        expect(readStoredZipPassword()).toBe('  reusable password  ');

        storeZipPassword('');
        expect(readStoredZipPassword()).toBe('');
    });

    it('should tolerate unavailable local storage', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });

        expect(readStoredZipPassword()).toBe('');
        expect(() => storeZipPassword('secret')).not.toThrow();
    });
});
