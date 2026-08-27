import { describe, expect, it } from 'bun:test';
import path from 'node:path';

type PackageManifest = {
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports?: Record<string, { import: string; types: string }>;
    files?: string[];
    imports?: Record<string, string>;
    name: string;
    scripts?: Record<string, string>;
    version: string;
    workspaces?: string[];
};

const readPackageManifest = async (): Promise<PackageManifest> => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    return Bun.file(packageJsonPath).json();
};

const removedDependencies = [
    '@inquirer/prompts',
    '@modelcontextprotocol/sdk',
    '@tanstack/match-sorter-utils',
    '@tanstack/react-devtools',
    '@tanstack/react-router-devtools',
    '@tanstack/router-plugin',
    'iconv-lite',
] as const;
const requiredUiDevelopmentDependencies = [
    '@tailwindcss/typography',
    '@tailwindcss/vite',
    '@tanstack/devtools-vite',
    '@tanstack/react-query',
    '@tanstack/react-router',
    '@tanstack/react-start',
    '@vitejs/plugin-react',
    'react',
    'react-dom',
    'tailwindcss',
    'vite',
] as const;
const requiredDevelopmentDependencies = [
    '@biomejs/biome',
    '@testing-library/react',
    '@types/react',
    '@vitest/coverage-v8',
    'jsdom',
    'typescript',
    'vitest',
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
    it('should expose one API-driven executable', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.bin).toEqual({
            spiracha: './bin/spiracha.ts',
        });
    });

    it('should not keep CLI or MCP runtime dependencies', async () => {
        const manifest = await readPackageManifest();

        for (const dependencyName of removedDependencies) {
            expect(manifest.dependencies?.[dependencyName]).toBeUndefined();
            expect(manifest.devDependencies?.[dependencyName]).toBeUndefined();
        }
    });

    it('should keep only direct client dependencies at runtime', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.dependencies).toEqual({ fflate: '0.8.3' });

        for (const dependencyName of requiredUiDevelopmentDependencies) {
            expect(manifest.devDependencies?.[dependencyName], dependencyName).toBeDefined();
        }
    });

    it('should use one package manifest for root, UI, and direct client workflows', async () => {
        const manifest = await readPackageManifest();

        expect(await Bun.file(path.join(process.cwd(), 'apps/ui')).exists()).toBe(false);
        expect(manifest.workspaces).toBeUndefined();
        expect(manifest.imports).toEqual({
            '#/*': './src/ui/*',
            '#package-metadata': './package.json',
        });

        for (const command of Object.values(manifest.scripts ?? {})) {
            expect(command).not.toContain('apps/ui');
        }
    });

    it('should own all repository development tooling at the root', async () => {
        const manifest = await readPackageManifest();

        for (const dependencyName of requiredDevelopmentDependencies) {
            expect(manifest.devDependencies?.[dependencyName], dependencyName).toBeDefined();
        }

        expect(manifest.scripts?.['test:ui']).toBe('vitest run --config vitest.config.ts');
        expect(manifest.scripts?.typecheck).toBe('bunx tsc --noEmit');
        expect(manifest.scripts?.['typecheck:root']).toBeUndefined();
        expect(manifest.scripts?.['typecheck:ui']).toBeUndefined();
    });

    it('should require the packed bunx smoke test before publishing', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.scripts?.['test:package']).toBe('bun run ./src/package-smoke.ts');
        expect(manifest.scripts?.build).toContain('build:ui');
        expect(manifest.scripts?.build).toContain('build:server');
        expect(manifest.scripts?.['build:server']).toBe('bun run ./src/build-server.ts');
        expect(manifest.scripts?.prepublishOnly).toBe('bun run build && bun run test:package');
    });

    it('should document every supported source in contributor and UI metadata', async () => {
        const sourceLabels = [
            'Codex',
            'Claude Code',
            'Grok',
            'Kiro',
            'Qoder',
            'Cursor',
            'Antigravity',
            'FX',
            'MiniMax Code',
            'OpenCode',
        ];
        const documentedFiles = ['README.md', 'AGENTS.md', 'src/ui/routes/__root.tsx'];

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

    it('should pack the CLI and direct client behind one manifest', async () => {
        const proc = Bun.spawn([process.execPath, 'pm', 'pack', '--dry-run'], {
            cwd: process.cwd(),
            stderr: 'pipe',
            stdout: 'pipe',
        });
        const [exitCode, stderrText, stdoutText] = await Promise.all([
            proc.exited,
            new Response(proc.stderr).text(),
            new Response(proc.stdout).text(),
        ]);
        const output = `${stdoutText}\n${stderrText}`;

        expect(exitCode).toBe(0);
        expect(output).toMatch(/packed .*package\.json/u);
        expect(output).toContain('bin/spiracha.ts');
        expect(output).toContain('src/client.ts');
        expect(output).not.toContain('vite.config.ts');
        expect(output).not.toContain('src/ui/routes/__root.tsx');
        expect(output).not.toContain('apps/ui');
    });

    it('should keep the package file list free of removed CLI files', async () => {
        const manifest = await readPackageManifest();

        expect(manifest.files).toContain('src/lib/**/*.ts');
        expect(manifest.files).toContain('src/client.ts');
        expect(manifest.files).toContain('bin/spiracha.ts');
        expect(manifest.files).toContain('dist/**/*');
        expect(manifest.files).toContain('!dist/server/**/*');
        expect(manifest.files).not.toContain('src/ui/**/*');
        expect(manifest.files).not.toContain('public/**/*');
        expect(manifest.files).not.toContain('vite.config.ts');
        expect(manifest.files).not.toContain('tsconfig.json');
        expect(manifest.files).toContain('!src/lib/**/*.test.ts');
        expect(manifest.files).toContain('!src/lib/*-test-helpers.ts');
        expect(manifest.files).not.toContain('STABLE_DATA_API.md');
        for (const filePath of removedPackagedFiles) {
            expect(manifest.files).not.toContain(filePath);
        }
    });
});
