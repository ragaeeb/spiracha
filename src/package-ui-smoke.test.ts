import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { getPackedTarballPath, isPackagedUiHealthyResponse, runPackagedUiSmokeTest } from './package-ui-smoke';

const PACKAGE_UI_SMOKE_TIMEOUT_MS = 180_000;

describe('package ui smoke helpers', () => {
    it('should include packaged source helpers needed by browser export modules', async () => {
        const manifest = (await Bun.file(path.join(import.meta.dir, '..', 'package.json')).json()) as {
            files: string[];
        };

        expect(manifest.files).toContain('src/lib/claude-code-transcript-phase.ts');
        expect(manifest.files).toContain('src/lib/concurrency.ts');
        expect(manifest.files).toContain('src/lib/kiro-transcript-phase.ts');
        expect(manifest.files).toContain('src/lib/opencode-transcript-phase.ts');
        expect(manifest.files).toContain('src/lib/qoder-transcript-phase.ts');
        expect(manifest.files).toContain('src/lib/ui-export-archive.ts');
    });

    it('should derive the packed tarball path from the package name and version', () => {
        expect(getPackedTarballPath('/tmp/spiracha', 'spiracha', '1.1.0')).toBe(
            path.join('/tmp/spiracha', 'spiracha-1.1.0.tgz'),
        );
    });

    it('should reject Bun fallback responses as unhealthy packaged UI responses', () => {
        expect(
            isPackagedUiHealthyResponse({
                bodyText: 'Welcome to Bun! To get started, return a Response object.',
                contentType: 'text/plain;charset=utf-8',
                ok: true,
                status: 200,
            }),
        ).toBe(false);
    });

    it('should accept SSR HTML responses that include the Spiracha app shell', () => {
        expect(
            isPackagedUiHealthyResponse({
                bodyText: '<!DOCTYPE html><html><body><h1>Spiracha</h1></body></html>',
                contentType: 'text/html; charset=utf-8',
                ok: true,
                status: 200,
            }),
        ).toBe(true);
    });

    it(
        'should serve the UI through the packaged bunx path',
        async () => {
            await runPackagedUiSmokeTest();
        },
        PACKAGE_UI_SMOKE_TIMEOUT_MS,
    );
});
