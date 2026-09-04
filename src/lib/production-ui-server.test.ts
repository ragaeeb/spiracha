import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProductionUiFetch, resolveClientAssetPath } from './production-ui-server';
import { UI_EXPORT_DIR_ENV } from './ui-export-files';

const originalExportDir = process.env[UI_EXPORT_DIR_ENV];
const tempPaths: string[] = [];

afterEach(async () => {
    if (originalExportDir === undefined) {
        delete process.env[UI_EXPORT_DIR_ENV];
    } else {
        process.env[UI_EXPORT_DIR_ENV] = originalExportDir;
    }
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('production UI server', () => {
    it('should resolve only paths inside the client build', () => {
        expect(resolveClientAssetPath('/app/dist/client', '/assets/app.js')).toBe(
            path.join('/app/dist/client', 'assets/app.js'),
        );
        expect(resolveClientAssetPath('/app/dist/client', '/')).toBeNull();
        expect(resolveClientAssetPath('/app/dist/client', '/../secret')).toBeNull();
        expect(resolveClientAssetPath('/app/dist/client', '/%2e%2e/secret')).toBeNull();
        expect(resolveClientAssetPath('/app/dist/client', '/%zz')).toBeNull();
    });

    it('should serve built assets and delegate application routes', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-production-ui-'));
        tempPaths.push(root);
        const clientDirectory = path.join(root, 'client');
        await Bun.write(path.join(clientDirectory, 'assets/app.js'), 'export {};');
        const fetch = createProductionUiFetch({
            appFetch: () => new Response('SSR', { headers: { 'Content-Type': 'text/html' } }),
            clientDirectory,
        });

        const asset = await fetch(new Request('http://localhost:3000/assets/app.js'));
        expect(await asset.text()).toBe('export {};');
        expect(asset.headers.get('Cache-Control')).toContain('immutable');
        expect(asset.headers.get('X-Content-Type-Options')).toBe('nosniff');

        const assetHead = await fetch(new Request('http://localhost:3000/assets/app.js', { method: 'HEAD' }));
        expect(await assetHead.text()).toBe('');
        expect(assetHead.headers.get('Cache-Control')).toContain('immutable');

        const route = await fetch(new Request('http://localhost:3000/threads/123'));
        expect(await route.text()).toBe('SSR');
        expect(route.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should serve generated exports with attachment headers', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-production-export-'));
        tempPaths.push(root);
        process.env[UI_EXPORT_DIR_ENV] = root;
        await Bun.write(path.join(root, 'report.md'), '# Report\n');
        const fetch = createProductionUiFetch({ appFetch: () => new Response('SSR'), clientDirectory: root });

        const response = await fetch(new Request('http://localhost:3000/__exports/report.md'));

        expect(await response.text()).toBe('# Report\n');
        expect(response.headers.get('Content-Disposition')).toContain('report.md');
        expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');

        const head = await fetch(new Request('http://localhost:3000/__exports/report.md', { method: 'HEAD' }));
        expect(await head.text()).toBe('');
        expect(head.headers.get('Content-Disposition')).toContain('report.md');

        const post = await fetch(new Request('http://localhost:3000/__exports/report.md', { method: 'POST' }));
        expect(post.status).toBe(405);
        expect(post.headers.get('Allow')).toBe('GET, HEAD');
    });

    it('should reject cross-origin browser requests before delegating application work', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-production-origin-'));
        tempPaths.push(root);
        let delegated = false;
        const fetch = createProductionUiFetch({
            appFetch: () => {
                delegated = true;
                return new Response('SSR');
            },
            clientDirectory: root,
        });

        const response = await fetch(
            new Request('http://localhost:3000/threads/123', {
                headers: { Origin: 'http://evil.example' },
            }),
        );

        expect(response.status).toBe(403);
        expect(delegated).toBe(false);
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should reject a non-loopback request even when its Origin matches', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-production-host-'));
        tempPaths.push(root);
        let delegated = false;
        const fetch = createProductionUiFetch({
            appFetch: () => {
                delegated = true;
                return new Response('SSR');
            },
            clientDirectory: root,
        });

        const response = await fetch(
            new Request('http://spiracha.local/threads/123', {
                headers: { Origin: 'http://spiracha.local' },
            }),
        );

        expect(response.status).toBe(403);
        expect(delegated).toBe(false);
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
});
