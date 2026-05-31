import { describe, expect, it } from 'bun:test';
import path from 'node:path';

type PackageManifest = {
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
    files?: string[];
    name: string;
    version: string;
};

const readPackageManifest = async (): Promise<PackageManifest> => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    return Bun.file(packageJsonPath).json();
};

const readUiPackageManifest = async (): Promise<PackageManifest> => {
    const packageJsonPath = path.join(process.cwd(), 'apps', 'ui', 'package.json');
    return Bun.file(packageJsonPath).json();
};

const publishedUiRuntimeDependencies = [
    '@tanstack/react-query',
    '@tanstack/react-router',
    '@tanstack/react-router-ssr-query',
    '@tanstack/react-table',
    '@tanstack/react-virtual',
    'class-variance-authority',
    'clsx',
    'lucide-react',
    'radix-ui',
    'react',
    'react-dom',
    'tailwind-merge',
    'zod',
] as const;

describe('package manifest', () => {
    it('should declare iconv-lite as a direct runtime dependency for bunx ui flows', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.dependencies).toBeDefined();
        expect(manifest.dependencies).toHaveProperty('iconv-lite');
    });

    it('should declare explicit relative bin entrypoints for npm publishing', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.bin).toEqual({
            'codex-chats': './bin/codex-chats.js',
            'codex-chats-claude': './bin/codex-chats-claude.js',
            spiracha: './bin/spiracha.js',
        });
    });

    it('should package the shared SVG app icon instead of generated logo copies', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.files).toContain('apps/ui/dist/client/icon.svg');
        expect(manifest.files).not.toContain('apps/ui/dist/client/favicon.ico');
        expect(manifest.files).not.toContain('apps/ui/dist/client/logo192.png');
        expect(manifest.files).not.toContain('apps/ui/dist/client/logo512.png');
    });

    it('should pin published UI runtime dependencies to the UI package versions', async () => {
        const [manifest, uiManifest] = await Promise.all([readPackageManifest(), readUiPackageManifest()]);

        for (const dependencyName of publishedUiRuntimeDependencies) {
            expect(manifest.dependencies?.[dependencyName]).toBe(uiManifest.dependencies?.[dependencyName]);
        }
    });
});
