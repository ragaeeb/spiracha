import { describe, expect, it } from 'bun:test';
import path from 'node:path';

type PackageManifest = {
    dependencies?: Record<string, string>;
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
});
