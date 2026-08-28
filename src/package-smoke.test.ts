import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import {
    buildPackagedUiProcessArgs,
    buildPackagedUiProcessEnv,
    getFirstPackagedAssetPath,
    getPackedTarballPath,
    isPackagedUiHealthyResponse,
} from './package-smoke';

describe('packaged UI smoke helpers', () => {
    it('should start the packaged production server explicitly', () => {
        expect(buildPackagedUiProcessArgs('/tmp/spiracha.tgz')).toEqual([
            '--package',
            '/tmp/spiracha.tgz',
            'spiracha',
            'serve',
        ]);
    });

    it('should bind the packaged UI to its isolated Codex fixture', () => {
        expect(
            buildPackagedUiProcessEnv(
                {
                    HOME: '/home/runner',
                    SPIRACHA_CODEX_DB: '/home/runner/.codex/state_5.sqlite',
                },
                45337,
                '/tmp/spiracha-package-smoke/state.sqlite',
            ),
        ).toMatchObject({
            HOME: '/home/runner',
            PORT: '45337',
            SPIRACHA_CODEX_DB: '/tmp/spiracha-package-smoke/state.sqlite',
        });
    });

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

    it('should find a built asset referenced by the app shell', () => {
        expect(
            getFirstPackagedAssetPath(
                '<html><head><link rel="stylesheet" href="/assets/styles-123.css"></head></html>',
            ),
        ).toBe('/assets/styles-123.css');
        expect(getFirstPackagedAssetPath('<html></html>')).toBeNull();
    });
});
