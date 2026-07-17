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

type UiPackageManifest = {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    pnpm?: unknown;
};

const readPackageManifest = async (): Promise<PackageManifest> => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    return Bun.file(packageJsonPath).json();
};

const readUiPackageManifest = async (): Promise<UiPackageManifest> => {
    const packageJsonPath = path.join(process.cwd(), 'apps/ui/package.json');
    return Bun.file(packageJsonPath).json();
};

const removedRuntimeDependencies = ['@inquirer/prompts', '@modelcontextprotocol/sdk', 'iconv-lite'] as const;
const requiredUiRuntimeDependencies = [
    '@tanstack/react-start',
    '@vitejs/plugin-react',
    'react',
    'react-dom',
    'vite',
] as const;

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

        for (const dependencyName of requiredUiRuntimeDependencies) {
            expect(manifest.dependencies?.[dependencyName]).toBeDefined();
        }
    });

    it('should keep mirrored UI runtime dependency versions aligned', async () => {
        const manifest = await readPackageManifest();
        const uiManifest = await readUiPackageManifest();
        const uiRuntimeDependencies = {
            ...uiManifest.dependencies,
            ...uiManifest.devDependencies,
        };

        for (const [dependencyName, uiVersion] of Object.entries(uiRuntimeDependencies)) {
            const rootVersion = manifest.dependencies?.[dependencyName];
            if (rootVersion) {
                expect(uiVersion, dependencyName).toBe(rootVersion);
            }
        }
    });

    it('should not retain configuration for unsupported package managers', async () => {
        const uiManifest = await readUiPackageManifest();

        expect(uiManifest.pnpm).toBeUndefined();
    });

    it('should document every supported source in contributor and UI metadata', async () => {
        const sourceLabels = ['Codex', 'Claude Code', 'Grok', 'Kiro', 'Qoder', 'Cursor', 'Antigravity', 'OpenCode'];
        const documentedFiles = ['README.md', 'AGENTS.md', 'apps/ui/AGENTS.md', 'apps/ui/src/routes/__root.tsx'];

        for (const filePath of documentedFiles) {
            const content = await Bun.file(path.join(process.cwd(), filePath)).text();
            for (const sourceLabel of sourceLabels) {
                expect(content, `${filePath} should mention ${sourceLabel}`).toContain(sourceLabel);
            }
        }
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
