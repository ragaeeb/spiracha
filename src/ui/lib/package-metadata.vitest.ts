import { describe, expect, it } from 'vitest';
import { packageMetadata, parsePackageMetadata } from './package-metadata';

describe('package metadata', () => {
    it('should expose validated build metadata through the package import alias', () => {
        expect(packageMetadata.homepage).toMatch(/^https:\/\//u);
        expect(packageMetadata.version).toMatch(/^\d+\.\d+\.\d+/u);
    });

    it('should fail loudly when required production metadata is missing', () => {
        expect(() => parsePackageMetadata({ homepage: '', version: '2.5.0' })).toThrow('homepage');
        expect(() => parsePackageMetadata({ homepage: 'https://example.com', version: '' })).toThrow('version');
        expect(() => parsePackageMetadata(null)).toThrow('package metadata');
    });
});
