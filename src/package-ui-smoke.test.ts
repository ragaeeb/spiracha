import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { getPackedTarballPath } from './package-ui-smoke';

describe('package ui smoke helpers', () => {
    it('should derive the packed tarball path from the package name and version', () => {
        expect(getPackedTarballPath('/tmp/spiracha', 'spiracha', '1.1.0')).toBe(
            path.join('/tmp/spiracha', 'spiracha-1.1.0.tgz'),
        );
    });
});
