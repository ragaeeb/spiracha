import { describe, expect, it } from 'bun:test';
import path from 'node:path';

type PackageManifest = {
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
    name: string;
    version: string;
};

const readPackageManifest = async (): Promise<PackageManifest> => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    return Bun.file(packageJsonPath).json();
};

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
});
