import { describe, expect, it } from 'bun:test';
import path from 'node:path';

type PackageManifest = {
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
    exports?: Record<string, { import: string; types: string }>;
    files?: string[];
    name: string;
    version: string;
};

const readPackageManifest = async (): Promise<PackageManifest> => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    return Bun.file(packageJsonPath).json();
};

const removedRuntimeDependencies = ['@inquirer/prompts', '@modelcontextprotocol/sdk', 'iconv-lite'] as const;

const removedPackagedFiles = [
    'bin/codex-chats.js',
    'bin/codex-chats-claude.js',
    'bin/spiracha.js',
    'src/export-chats.ts',
    'src/export-claude.ts',
    'src/export-cursor.ts',
    'src/mcp-server.ts',
    'src/lib/codex-exporter-cli.ts',
    'src/lib/codex-exporter-db.ts',
    'src/lib/codex-exporter-transcript.ts',
    'src/lib/codex-exporter-types.ts',
    'src/lib/codex-exporter.ts',
    'src/lib/interactive-cli.ts',
    'src/lib/native-open.ts',
] as const;

describe('package manifest', () => {
    it('should expose only the UI launcher executable after the CLI hard cut', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.bin).toEqual({
            spiracha: './bin/spiracha.ts',
        });
    });

    it('should not keep CLI or MCP runtime dependencies', async () => {
        const manifest = await readPackageManifest();

        for (const dependencyName of removedRuntimeDependencies) {
            expect(manifest.dependencies?.[dependencyName]).toBeUndefined();
        }
    });

    it('should keep UI runtime dependencies available for bunx execution', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.dependencies).toMatchObject({
            '@tanstack/react-start': '1.168.25',
            '@vitejs/plugin-react': '6.0.2',
            react: '19.2.7',
            'react-dom': '19.2.7',
            vite: '8.0.16',
        });
    });

    it('should publish the stable conversation API modules', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.exports).toEqual({
            '.': {
                import: './src/client.ts',
                types: './src/client.ts',
            },
            './client': {
                import: './src/client.ts',
                types: './src/client.ts',
            },
            './types': {
                import: './src/lib/conversation-data/types.ts',
                types: './src/lib/conversation-data/types.ts',
            },
        });
    });

    it('should keep the package file list free of removed CLI files', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.files).toContain('src/lib/**/*.ts');
        expect(manifest.files).toContain('src/client.ts');
        expect(manifest.files).toContain('bin/spiracha.ts');
        expect(manifest.files).toContain('apps/ui/src/**/*');
        expect(manifest.files).toContain('apps/ui/public/**/*');
        expect(manifest.files).toContain('apps/ui/vite.config.ts');
        expect(manifest.files).toContain('!apps/ui/src/**/*.vitest.ts');
        expect(manifest.files).toContain('!apps/ui/src/**/*.vitest.tsx');
        expect(manifest.files).toContain('!src/lib/**/*.test.ts');
        expect(manifest.files).toContain('!src/lib/*-test-helpers.ts');
        expect(manifest.files).not.toContain('STABLE_DATA_API.md');
        for (const filePath of removedPackagedFiles) {
            expect(manifest.files).not.toContain(filePath);
        }
    });
});
