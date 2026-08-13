import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { getPackedTarballPath, isPackagedUiHealthyResponse } from './package-smoke';

describe('packaged UI smoke helpers', () => {
    it('should derive the packed tarball path from package metadata', () => {
        expect(getPackedTarballPath('/tmp/spiracha', 'spiracha', '2.3.0')).toBe(
            path.join('/tmp/spiracha', 'spiracha-2.3.0.tgz'),
        );
    });

    it('should reject Bun fallback responses', () => {
        expect(
            isPackagedUiHealthyResponse({
                bodyText: 'Welcome to Bun! To get started, return a Response object.',
                contentType: 'text/plain; charset=utf-8',
                ok: true,
            }),
        ).toBe(false);
    });

    it('should accept the Spiracha SSR app shell', () => {
        expect(
            isPackagedUiHealthyResponse({
                bodyText: '<!doctype html><html><title>Spiracha</title></html>',
                contentType: 'text/html; charset=utf-8',
                ok: true,
            }),
        ).toBe(true);
    });
});
