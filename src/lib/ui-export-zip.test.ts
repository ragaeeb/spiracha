import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { zipExportDirectory, zipExportFile } from './ui-export-zip';

const tempPaths: string[] = [];

afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })));
});

describe('UI export ZIP helpers', () => {
    it('should create zip exports without a system zip executable', async () => {
        const implementation = await Bun.file(new URL('./ui-export-zip.ts', import.meta.url)).text();
        expect(implementation).not.toContain("Bun.spawn(['zip'");
        expect(implementation).not.toContain('level: 9');

        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ui-export-zip-'));
        tempPaths.push(tempRoot);
        const sourcePath = path.join(tempRoot, 'thread.md');
        const zipPath = path.join(tempRoot, 'thread.zip');
        await Bun.write(sourcePath, '# Exported thread\n');
        const proc = Bun.spawn(
            [
                process.execPath,
                '--eval',
                "import { zipExportFile } from './src/lib/ui-export-zip.ts'; await zipExportFile(process.env.TEST_SOURCE_PATH, process.env.TEST_ZIP_PATH);",
            ],
            {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    PATH: '',
                    TEST_SOURCE_PATH: sourcePath,
                    TEST_ZIP_PATH: zipPath,
                },
                stderr: 'pipe',
            },
        );
        const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
        if (exitCode !== 0) {
            throw new Error(stderr.trim() || `zip child process failed with exit code ${exitCode}`);
        }

        const bytes = new Uint8Array(await Bun.file(zipPath).arrayBuffer());
        expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    });

    it('should archive large files and nested export directories', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ui-export-zip-large-'));
        tempPaths.push(tempRoot);
        const sourceDirectory = path.join(tempRoot, 'source');
        const nestedDirectory = path.join(sourceDirectory, 'nested');
        const largeContent = `# Large thread\n${'tool output\n'.repeat(20_000)}`;
        await Bun.write(path.join(sourceDirectory, 'thread.md'), largeContent);
        await Bun.write(path.join(nestedDirectory, 'metadata.txt'), 'metadata');

        const singleZipPath = path.join(tempRoot, 'single.zip');
        await zipExportFile(path.join(sourceDirectory, 'thread.md'), singleZipPath);
        const singleEntries = unzipSync(new Uint8Array(await Bun.file(singleZipPath).arrayBuffer()));
        expect(strFromU8(singleEntries['thread.md']!)).toBe(largeContent);

        const directoryZipPath = path.join(tempRoot, 'directory.zip');
        await zipExportDirectory(sourceDirectory, directoryZipPath);
        const directoryEntries = unzipSync(new Uint8Array(await Bun.file(directoryZipPath).arrayBuffer()));
        expect(Object.keys(directoryEntries).sort()).toEqual(['nested/metadata.txt', 'thread.md']);
        expect(strFromU8(directoryEntries['nested/metadata.txt']!)).toBe('metadata');
        expect(strFromU8(directoryEntries['thread.md']!)).toBe(largeContent);
    });
});
