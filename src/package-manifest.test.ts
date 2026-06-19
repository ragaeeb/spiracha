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
    it('should not expose command line entrypoints after the CLI hard cut', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.bin).toBeUndefined();
    });

    it('should not keep CLI or MCP runtime dependencies', async () => {
        const manifest = await readPackageManifest();

        for (const dependencyName of removedRuntimeDependencies) {
            expect(manifest.dependencies?.[dependencyName]).toBeUndefined();
        }
    });

    it('should publish the stable conversation API modules', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.exports).toEqual({
            '.': {
                import: './src/lib/conversation-data/index.ts',
                types: './src/lib/conversation-data/index.ts',
            },
            './conversation-api': {
                import: './src/lib/conversation-api.ts',
                types: './src/lib/conversation-api.ts',
            },
            './conversation-data': {
                import: './src/lib/conversation-data/index.ts',
                types: './src/lib/conversation-data/index.ts',
            },
        });
    });

    it('should keep the package file list free of removed CLI files', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.files).toContain('src/lib/**/*.ts');
        expect(manifest.files).toContain('!src/lib/**/*.test.ts');
        expect(manifest.files).toContain('!src/lib/*-test-helpers.ts');
        for (const filePath of removedPackagedFiles) {
            expect(manifest.files).not.toContain(filePath);
        }
    });
});
